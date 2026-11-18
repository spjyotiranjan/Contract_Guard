# Contract Guard — Completed Phases

This document records the phases completed in this session and the scope of the current implementation. See [README.md](README.md) for setup, endpoints, and test commands.

## 1. The Foundation — Complete

Established the Next.js application, MongoDB-backed registry, and the API and service workflows. Registry identities and their uploaded revisions are stored separately, with validators, indexes, source hashes, timestamps, and unique record IDs. API and service entries can be created, listed, and viewed through the UI and registry endpoints.

## 2. API/Service YAML to JSON Parse and View — Complete

API OpenAPI YAML and service consumer YAML can be uploaded, validated for their core structure, parsed into JSON-compatible documents, and stored as revisions. API versions come from `info.version` or an explicitly supplied version and must be unique within the API; service definitions are unversioned revisions. Original document fields and source metadata are retained.

The UI provides an expandable definition tree. For services, declared uses are also grouped by API provider, then by endpoint, with sent and read fields and additional details. The complete definition remains available.

## 3. API Version Diff Analysis Creation and Persistence — Complete within current scope

The diff service compares any two distinct revisions of the same API and reports structural changes, categorized by parameters, request bodies, responses, schemas, components, paths, and other fields. Changes include before/after values when applicable and are capped at 5,000 with a truncation indicator. The API detail view connects adjacent revisions in upload order; selecting an edge opens a filterable comparison panel. Legacy same-version revisions remain distinct by record ID.

**Persistence distinction:** uploaded API revisions are persisted, but diff results are calculated on demand and are **not persisted** as separate records. The comparison is structural; it does not resolve `$ref` or determine whether changes are breaking.

## 4. Service Safety Matching to API Versions — Complete within current scope

Service definitions are analyzed against each registered revision of their declared API providers. The analysis checks exact endpoints and methods, parameters, request and response fields, required fields, and supported local `$ref` references. Results include reasons and are classified as a structural match, incompatible, or unknown; the UI displays unknown as **Warning**.

The registry overview presents service nodes and API boxes containing revisions. Connections lead to structurally matching revisions; dependencies without a confirmed match use dashed connections. Selecting a service highlights its edges and filters the side panel. Users can inspect revision results, drag nodes, and pan or zoom the canvas. The overview analyzes the latest uploaded service definition; an endpoint is available to analyze a specific historical definition.

**Scope distinction:** matching compares the service definition directly with each API revision; it does **not** use the version diff output or identify a service's actual deployed API version. Analysis and connections are calculated on demand, not persisted as bindings. A structural match is not a runtime safety guarantee: consumer definitions do not specify types, values, credentials, expected response statuses, or deployment details, and unsupported or ambiguous constructs may yield a warning.

## Remaining limitations

- Persisted diff records, explicit service-to-version binding management, and actual deployed-version tracking are not implemented.
- Full OpenAPI validation, authentication, and runtime compatibility verification are not implemented.
- Graph positions are temporary and reset on refresh; separate edge routes reduce overlap but may still cross.

## 5. API Version Runtime Health Checks — Planned

### Goal

Provision runnable endpoints for each API version in a webhook receiver, then check their availability on upload, every three minutes, and on demand. Show runtime health alongside, but separately from, the existing YAML-based service analysis. The current project has no receiver integration or scheduler.

### Proposed flow

1. **Upload and provision:** Validate and store the API version, run the existing structural analysis, and send its definition to the receiver using the API and version record IDs. Track provisioning as pending, successful, or failed, then run an initial check after successful provisioning. Keep the uploaded version if the receiver is unavailable and allow provisioning to be retried.
2. **Existing versions:** Provide an idempotent backfill operation to register existing versions independently by record ID. Skip successful registrations unless explicitly retried, and report failures without stopping the entire backfill.
3. **Runtime checks:** Check provisioned versions every three minutes and provide a manual check action. Prevent overlapping checks for a version. Store the latest result, check time, endpoint-level details, and errors. Mark results stale when checks stop running; distinguish pending, not checked, provisioning failure, check failure, partial health, and healthy states.
4. **Graph and details:** Show separate YAML analysis and runtime health labels and details for each service-to-version connection. Provide manual check and provisioning retry controls, and refresh health status without a full page reload. A reachable receiver endpoint must not be presented as proof of service compatibility or real API health.
5. **Persistence and APIs:** Persist provisioning and health records keyed by API version ID. Add endpoints for provisioning, backfill, manual checks, and results. Include stored health summaries in graph responses without live network calls during graph loading.
6. **Scheduling and security:** Use a reliable background worker or external scheduled job rather than a timer in a Next.js request handler. Add timeouts, bounded concurrency, retries, and coordination across app instances. Define receiver authentication, idempotency, and a restricted receiver address to prevent arbitrary outbound requests.
7. **Verification:** Test provisioning, retries, backfill, scheduled and manual checks, receiver downtime, partial failures, stale results, duplicate job prevention, and graph presentation using a controlled test receiver.

### Decisions needed before implementation

- Does a webhook receiver already exist? If so, where is it and what is its API contract? Otherwise, should it be built in this project or as a separate service?
- Are receiver endpoints simulated from YAML or tied to deployed API versions? A simulated endpoint check verifies the receiver, not the real deployed API.
- Should the receiver provide a non-mutating probe interface, or must checks invoke generated endpoints directly? Direct calls may require credentials, parameters, and bodies or cause side effects.
- Where will Contract Guard run, and can it run a persistent worker or external scheduled job?
- Can the receiver accept the stored JSON definition, or must the original YAML bytes be retained and sent?
