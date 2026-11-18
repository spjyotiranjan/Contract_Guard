# Contract Guard

A Next.js registry for APIs and services. The existing `specs/` and `consumers/` directories contain sample OpenAPI and consumer YAML files.

## Getting started

Requirements: Node.js 20.19 or newer and npm. MongoDB is needed when working with database-backed features.

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and update the MongoDB connection settings if needed.
3. Start MongoDB and initialize registry validators and indexes: `npm run db:init`
4. Start the app: `npm run dev`
5. Open [http://localhost:3000](http://localhost:3000).

The MongoDB helper in `src/lib/mongodb.ts` is server-only and connects on demand. MongoDB is not required to view the initial page. For a local MongoDB server, the example settings use `mongodb://127.0.0.1:27017` and the `contract_guard` database.

## Registry schemas

Run `npm run db:init` against a running MongoDB instance before using the registry endpoints, and again after schema changes. The command reads `.env.local` (or other Next.js environment files), needs permission to create collections, modify validators, and create indexes, and can be run again. Existing data is not migrated or validated retroactively; duplicate keys can make index creation fail. It does not import the example files.

The schema and TypeScript document types are in `src/lib/registry/`. Four collections separate registry identities from version revisions:

| Collection | Purpose |
| --- | --- |
| `apis`, `services` | Unique, case-sensitive `name` and an `owner`, with timestamps. Names are stable identifiers, such as `quote-api` or `mobile-app`. |
| `api_versions` | A parent `apiId`, version, source hash, timestamp, and the complete parsed OpenAPI document in `definition`. The version must match `definition.info.version`. |
| `service_versions` | An unversioned service definition revision: parent `serviceId`, source hash, timestamp, complete parsed consumer document, and API revision `bindings`. The collection retains its original name. |

The OpenAPI definition is kept intact, including paths, components, `$ref` strings, extensions, and fields not known to the registry. Consumer definitions retain `consumer`, `team`, and `uses` entries with their provider, method, path, sends, and reads. Field paths such as `premium.breakdown[].label` remain strings. Extra fields are preserved; the MongoDB validators check the core structure, not full OpenAPI validity or whether references resolve.

API version strings are unique per API, regardless of YAML contents or source hash; the same version may be used by different APIs. Uploading a duplicate returns 409. Service definition revisions remain unique by parent ID and `sourceHash` (lowercase SHA-256 of the original YAML bytes). The source filename is informational only.

Run `npm run db:init` after upgrading to install the unique API/version index, which also protects concurrent uploads. Existing duplicate versions prevent index creation; review and resolve them before retrying. Initialization does not delete or automatically migrate records. Existing legacy duplicates remain accessible until resolved. The two sample claims 1.1.0 files cannot both be uploaded to the same API without changing one version.

Service YAML does not contain a version. Its `consumer` must match the service's stable name; `team` is source metadata, while the registry owner is entered separately. API names and owners are also supplied separately from the OpenAPI title and description. Consumer YAML does not specify API versions. A service revision starts with an empty `bindings` array; a future explicit binding can identify a `uses` entry by zero-based `useIndex` and exact `apiVersionId`. Versions are never inferred from provider names or endpoint matches.

MongoDB does not enforce foreign keys or all cross-document rules. Future binding flows must verify that each binding points to the matching provider's API revision, that `useIndex` is in range and appears at most once. API version strings are opaque and not automatically ordered or required to be semantic versions.

## Registry endpoints

Responses use `{ "data": ... }` on success and `{ "error": "..." }` on failure. IDs are MongoDB ObjectId strings. Names are unique within each registry and are case-sensitive. The API has no authentication yet and should only be exposed in a trusted environment.

| Method | Route | Purpose |
| --- | --- | --- |
| GET, POST | `/api/apis`, `/api/services` | List entries, or create with JSON `{ "name": "...", "owner": "..." }`. |
| GET | `/api/apis/{id}`, `/api/services/{id}` | Get an entry. |
| GET, POST | `/api/apis/{id}/versions` | List versions, or upload multipart `file` and optional `version`. A version is required if `info.version` is absent from the YAML. |
| GET | `/api/apis/{id}/versions/{versionId}` | Get one version revision by its record ID. |
| GET | `/api/apis/{id}/diff?from={versionId}&to={versionId}` | Compare any two distinct revisions belonging to the API, from old to new. |
| GET, POST | `/api/services/{id}/definitions` | List definitions, or upload multipart `file` (no version). |
| GET | `/api/services/{id}/definitions/{definitionId}` | Get one service definition. |
| GET | `/api/services/{id}/definitions/{definitionId}/analysis` | Analyze a specific service definition against registered API revisions. |
| GET | `/api/registry/graph` | Return registry nodes and analysis for the latest uploaded definition of each service. |

Examples (replace IDs with the `_id` from each response):

```sh
curl -X POST http://localhost:3000/api/apis -H 'Content-Type: application/json' -d '{"name":"quote-api","owner":"Quotes"}'
curl -X POST http://localhost:3000/api/apis/API_ID/versions -F 'version=1.0.0' -F 'file=@specs/quote-api/1-initial.yaml'
curl -X POST http://localhost:3000/api/services -H 'Content-Type: application/json' -d '{"name":"mobile-app","owner":"Mobile"}'
curl -X POST http://localhost:3000/api/services/SERVICE_ID/definitions -F 'file=@consumers/mobile-app.yaml'
```

Uploads accept one UTF-8 `.yaml` or `.yml` file of at most 1 MiB. API versions are read from OpenAPI `info.version`; if absent, provide `version`, which is added to the stored definition. If both are present they must match exactly. Invalid or empty declared versions are rejected rather than overwritten. The source hash always reflects the original YAML bytes, not the modified stored definition. The service `consumer` must exactly match the registry name. Request validation runs before YAML parsing and saving. The parser checks JSON-compatible data and core OpenAPI/service fields, but does not fully validate OpenAPI or resolve `$ref` references. HTTP methods in service definitions are normalized to uppercase. A malformed request returns 400, unsupported content type 415, unknown entity 404, and duplicate name or identical upload 409. Definitions and revision lists return the complete parsed documents; no pagination is implemented yet.

## Version differences

The API detail page connects consecutive revisions in upload order, oldest first. Select a connection to see the structural changes in the right panel. This is an upload timeline, not semantic version order or a claim of ancestry; legacy same-version revisions are distinguished by source filename and ID. The diff endpoint can compare any two revisions of the same API, in either direction, without creating or persisting separate diff records.

The response contains `from`, `to`, `changes`, and `truncated`. Each change has an `action`, `category`, a path as an array of segments, and `before` and/or `after` JSON values; absent values are omitted and JSON `null` is preserved. The UI displays escaped JSON-pointer-like paths. Changes are grouped into parameters, request bodies, responses, schemas, other components, paths/operations, and other fields. An added or removed object is represented as a single change containing the whole object, rather than separate changes for every child. Object key order is ignored; parameter arrays are matched by `in` and `name` (or literal `$ref`) when possible, and `required` and `enum` scalar arrays are compared as sets. Other arrays are compared by index. Changes are capped at 5,000 and flagged when truncated.

This is a structural comparison, not a compatibility assessment: it does not resolve `$ref`, interpret inheritance, identify breaking changes, or match renamed endpoints. A reference change is reported literally, and changes to a referenced component are reported under that component rather than repeated at every use.

## Service dependency analysis

The overview graph uses the most recently uploaded service definition (timestamp, then record ID as a tie-breaker). Each provider name is matched exactly to a registered API name. Green connections end at API revisions that pass supported structural checks; dashed connections represent a declared dependency without a structural match. Drag nodes to rearrange them, pan or zoom the canvas, and select a service to highlight its connections. Positions are temporary and reset on refresh. Separate connection ports and routes reduce overlap, though lines can still cross. Select an edge or a connection in the side panel to see all revision results and reasons. Unregistered providers and APIs without revisions are shown separately. Historical service definitions can be analyzed via the definition-specific endpoint. Analysis is computed on demand, is not persisted, and does not create actual service-to-version bindings.

The analysis compares exact method and path strings, declared parameters and required parameters, JSON request fields and required request properties, and fields in each explicitly declared successful JSON response. It follows local `$ref` references, handles nested properties and `[]` field paths, and checks whether response fields are marked required. Revisions are identified by record ID even when version labels are identical. It reports `match`, `incompatible`, or `unknown` with issue codes and explanations. Unresolved references, unsupported composition, optional response fields, authentication, ambiguous media types, and other unverifiable constructs result in `unknown` unless a definite incompatibility is also found. If any endpoint is incompatible, the provider revision is incompatible overall. `match` means only that supported structural checks passed; it **does not guarantee safety or runtime compatibility**. Consumer YAML does not specify value types, enum values, authentication credentials, response status expectations, deployment configuration, or actual version usage. These are not validated. Paths with renamed parameters are not treated as equivalent. Response checking is conservative across all declared 2xx statuses.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test:registry` with `TEST_MONGODB_URI` set to a MongoDB connection string. This integration test creates and drops a uniquely named test database on that server.
- `npm run test:registry:http` with `TEST_BASE_URL` pointing to a running app connected to an isolated test database. This test writes records to that database and does not remove them.
- `npm run test:registry:ui` with `TEST_BASE_URL` pointing to a running app connected to an isolated test database. This browser test writes records and does not remove them. Install Playwright Chromium (`npx playwright install chromium`) or set `TEST_BROWSER_PATH` to an existing Chromium executable.
- `npm run test:diff` tests the structural comparison, including sample OpenAPI files.
- `npm run test:analysis` tests service compatibility analysis against sample and synthetic contracts.

## Scope

The registry UI supports listing, creating and viewing entities, uploading YAML, inspecting parsed definitions, and viewing derived service/API connections. Authentication, explicit API-version binding management, and full OpenAPI validation are not implemented yet.
