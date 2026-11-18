# Contract Guard

Contract Guard is a Next.js and MongoDB registry for OpenAPI contracts and the services that consume them. Upload API versions and consumer definitions, compare contract changes, and explore which provider versions match a service's declared endpoints and fields.

For the commit history and current status, see [Progress.md](Progress.md). The runtime health work is described in [Plan.md](Plan.md).

## Run locally

Use Node.js 20.19 or newer, npm, and a running MongoDB instance. The sample environment connects to MongoDB at `127.0.0.1:27017` and uses the `contract_guard` database.

From the repo root in PowerShell:

```powershell
npm ci
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm run db:init
npm run dev
```

If you already have `.env.local`, keep it and check its MongoDB settings. Open [localhost:3000](http://localhost:3000). Run `npm run db:init` again after schema or index changes. It initializes collections, validators, and indexes. If existing records share an API and version label, resolve those duplicates before retrying.

## Try the registry

1. Create an API named `quote-api` and upload [1-initial.yaml](specs/quote-api/1-initial.yaml) and [2-reorganised.yaml](specs/quote-api/2-reorganised.yaml).
2. Create a service named `mobile-app` and upload its [consumer definition](consumers/mobile-app.yaml).
3. On the API detail page, select the link between versions to inspect the diff. On the registry overview, select the service or a graph connection to see compatibility results and their reasons.

Uploads accept one UTF-8 `.yaml` or `.yml` file up to 1 MiB. API versions come from `info.version` in the YAML. Supply a version when that field is missing. API version labels are unique within each API, so choose one of the two Claims `1.1.0` fixtures for a single registry entry. A service's `consumer` must match its registry name exactly. Service definitions are unversioned, and identical uploads to the same service return `409`.

The diff compares stored definitions on demand and caps results at 5,000 changes. The dependency graph uses the latest uploaded definition for each service and checks exact methods and paths, parameters, JSON fields, and supported local `$ref` references. Green edges represent structural matches. Dashed edges represent declarations without a confirmed match. The graph models declared usage, and deployed-version bindings are still pending.

## Contract body variations

The separate variation check uses the existing `sends` and `reads` fields to generate hypothetical presence combinations, bounded to 512 cases. It compares them with supported API parameters and JSON body schemas. It assumes each listed field can independently be present or omitted; these are possibilities to investigate, not known service behavior. The result remains a warning because the lists do not provide values, requiredness, correlations, or response-handling behavior. It reports potential concerns and a representative field combination; it does not manufacture request values.

An optional `contract` on a service `uses` entry adds stronger JSON body checks without replacing the existing fields. The extension describes what the service **may send** and what it **can accept**, not what it actually sends or receives. For example:

```yaml
consumer: example-service
team: Example
uses:
  - provider: example-api
    method: POST
    path: /items
    sends: [enabled, mode]
    reads: [ok]
    contract:
      version: 1
      request:
        body: required # required, optional, or none
        schema:
          type: object
          required: [enabled]
          additionalProperties: false
          properties:
            enabled: {type: boolean}
            mode: {type: string, enum: [basic, advanced]}
      responses:
        '200':
          body: optional # service accepts a present or omitted body
          schema: {type: boolean}
```

`body: none` must not have a schema. `required` and `optional` need a schema; response entries declare the service's accepted body policy per explicit status. Request bodies are generated from the service schema and checked against the API schema. Response bodies are generated from each API response schema and checked against the service schema. Undeclared status handling, wildcard statuses, response body presence, other media types, parameters, authentication, and serialization are not proven. OpenAPI response `content` does not guarantee that a body is present; a service requiring a body gets a warning.

The supported schema subset is explicit `type` (`object`, `array`, `string`, `integer`, `number`, `boolean`, `null`), scalar `enum`, numeric `minimum`/`maximum`, object `properties`/`required`/boolean `additionalProperties`, array `items`/`minItems`/`maxItems`, and nullability using `nullable` for consumer and OpenAPI 3.0 schemas or a type union with `null` for OpenAPI 3.1. Local references are followed safely. Omitted `additionalProperties` means allowed, not false. Unsupported keywords, external references, composition, and unresolved schemas produce a warning. Missing `required` means all declared properties are optional; the service author is responsible for accurately declaring its behavior.

Finite cases are enumerated up to 512 per check, with depth 12, 16 properties per object and array length 5; larger or unbounded spaces use limited deterministic samples or are unavailable. A passing sample yields **Warning**, not compatibility. A valid generated counterexample yields **Incompatible**; exhaustive compatibility refers only to the supported body contract, not runtime behavior. Check details appear separately from structural results in the graph and in the `variations` field of analysis responses. Green edges still denote structural matches only. Results are calculated on demand, not persisted. Run `npm run db:init` to apply the optional contract validator after upgrading.

## Starter-kit receivers

| Receiver | Default address | Purpose |
| --- | --- | --- |
| Notification webhook | [localhost:9900](http://localhost:9900/) | Test inbox for HTTP POSTs. View messages on the dashboard or retrieve them through `GET /api/received`. |
| Simulated contract receiver | `127.0.0.1:9910` in Docker | Provisions version-specific mock routes over an authenticated WebSocket. |

Start the notification webhook from the repo root:

```powershell
docker compose -f contract-guard-starter-kit/docker-compose.yml up -d --build webhook-receiver
```

For the optional contract receiver, set `RECEIVER_TOKEN` in your shell to a secret of at least 16 characters, then start the service:

```powershell
docker compose -f contract-guard-starter-kit/docker-compose.yml --profile contracts up -d --build contract-receiver
```

In the registry's `.env.local`, set `CONTRACT_RECEIVER_WS_URL=ws://127.0.0.1:9910/ws` and `CONTRACT_RECEIVER_TOKEN` to the same secret, then restart the app. To run the receiver outside Docker, run `npm ci` and `npm start` in `contract-guard-starter-kit/contract-receiver` with `RECEIVER_TOKEN` set. The standalone receiver defaults to port `9100`, so use that port in the registry URL.

An API upload saves the version in MongoDB before sending a YAML serialization of the stored definition. The upload response includes the provisioning outcome, and existing versions can be provisioned or retried through the registry endpoint below. The receiver persists provisioned contracts to disk. Its authenticated routes are `GET /contracts/{apiId}/{versionId}` and `/mock/{apiId}/{versionId}/{path}` for declared methods. Pass `Authorization: Bearer <token>`. Mock routes return acknowledgments. Provisioning supports inline paths and whole-segment path parameters. Use localhost for plain `ws`, or `wss` for remote receivers.

## Registry API

The API uses MongoDB ObjectId strings and normally returns `{ "data": ... }` on success or `{ "error": "..." }` for request errors. Use the registry in a trusted environment because its routes currently have no authentication.

| Method | Route | Purpose |
| --- | --- | --- |
| GET, POST | `/api/apis`, `/api/services` | List entries or create one with JSON fields `name` and `owner`. |
| GET | `/api/apis/{id}`, `/api/services/{id}` | Get a registry entry. |
| GET, POST | `/api/apis/{id}/versions` | List versions or upload multipart `file` and optional `version`. |
| GET | `/api/apis/{id}/versions/{versionId}` | Get a stored API version. |
| GET | `/api/apis/{id}/diff?from={versionId}&to={versionId}` | Compare two versions belonging to the same API. |
| POST | `/api/apis/{id}/versions/{versionId}/provision` | Provision or retry a stored version. An unavailable or unconfigured receiver returns `503` with the outcome in `data`. |
| GET, POST | `/api/services/{id}/definitions` | List definitions or upload multipart `file`. |
| GET | `/api/services/{id}/definitions/{definitionId}` | Get a stored service definition. |
| GET | `/api/services/{id}/definitions/{definitionId}/analysis` | Analyze a specific service definition. |
| GET | `/api/registry/graph` | Get registry nodes and analysis for the latest definitions. |

## Checks

| Command | Prerequisites |
| --- | --- |
| `npm run lint`, `npm run typecheck`, `npm run build` | Root dependencies installed. |
| `npm run test:diff`, `npm run test:analysis`, `npm run test:variations` | Root dependencies and sample YAML. |
| `npm run test:registry` | Set `TEST_MONGODB_URI`. The suite creates and drops dedicated test databases. |
| `npm run test:registry:http`, `npm run test:registry:ui` | Set `TEST_BASE_URL` to an app connected to an isolated database. Both suites leave test records. The UI suite needs Playwright Chromium or `TEST_BROWSER_PATH`. |
| `npm run test:receiver`, `npm --prefix contract-guard-starter-kit/contract-receiver test` | Install the contract receiver's dependencies with `npm ci` in its directory. |
