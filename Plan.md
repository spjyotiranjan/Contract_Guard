# Contract Guard — Project Plan

This document records completed and planned phases and the scope of the current implementation. See [README.md](README.md) for setup, endpoints, and test commands.

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

## 4.5. Service Request and Response Variations — Implemented (initial subset)

The first implementation uses existing `sends` and `reads` to generate bounded hypothetical field-presence combinations; no additional service YAML is required. Because those lists do not establish optionality, values or correlations, the results remain warnings rather than confirmed incompatibilities. Optional v1 service body contracts enable stronger bounded finite enumeration and representative samples. Results are separate in the graph and service analysis API. Supported schemas, limits, and examples are documented in the README. This is contract-only analysis, not runtime verification. Conditional composition, richer media and parameter handling, larger exhaustive domains, and implementation-level verification remain future work.

### Goal and limitations

Add a separate contract-variation check alongside the existing structural service-to-API analysis. For each service definition and API revision, compare the request variations the service may send and the response variations it can handle with the API's OpenAPI definition. Never present a finite collection of sampled cases as proof of compatibility across an infinite or unexplored space. Results concern declared contracts, not deployed behavior.

The existing consumer YAML only names fields in `sends` and `reads`; it does not specify possible values, presence, types, correlations, or expected responses. Preserve legacy YAML unchanged and report hypothetical presence cases as **Warning** rather than asserting these assumptions are real. Existing structural results remain separately visible.

### Consumer contract extension

1. Add an optional versioned extension on each `uses` entry for consumer request and response contracts, specifying method and path via the existing fields. Define and document the exact syntax and a restricted supported schema dialect before implementation. Continue accepting existing definitions and preserving additional fields.
2. Request contracts must describe JSON bodies including whether the body is present or optional, explicit required and optional properties, types, nullability, enum and numeric constraints, nested objects and arrays, and additional-property policy. Represent meaningful alternatives and conditional relationships only where the chosen supported dialect can evaluate them. Missing information must not be inferred from `sends`.
3. Response contracts describe what the service can accept, including explicit status code and JSON media-type expectations, body presence, required fields, allowed values, and extra-field handling. A response is not a body sent by the service: the check must model responses the API may produce and the service can consume. An unspecified response capability is unknown, not unlimited.
4. Clearly distinguish incomplete information from an unconstrained field. If source declarations are claimed to be exhaustive, state that this is an author-provided assumption, not proof of service behavior. Validate extensions on upload with useful field-level errors, add TypeScript types and MongoDB validation where appropriate, and avoid breaking persisted legacy documents. Document any database initialization requirements.

### Comparison and generation

1. Check in the correct direction: **service request domain ⊆ API accepted request domain**, and **API possible response domain ⊆ service accepted response domain**, for each applicable status and media type. For the first milestone focus on JSON request and response bodies; parameters, headers, auth, and request serialization remain explicitly unverified unless separately supported.
2. Resolve local references safely, with cycle and depth limits. Select an OpenAPI-version-aware schema validator and define support for OpenAPI 3.0 versus 3.1 nullability, required fields, read/write-only properties, and `additionalProperties`. External or unresolved references, unsupported composition or conditions, ambiguous media types/statuses, and unsupported keywords must produce Warning, never a successful proof.
3. For genuinely finite domains, enumerate all valid combinations, including optional fields, nested objects, enums, nullability, arrays and alternatives when bounded. Report expected and executed counts. Enforce configurable maximum case count, nesting, array size and runtime; if a limit is hit or finiteness cannot be established, mark coverage incomplete and result Warning unless a definite counterexample is found.
4. For large or infinite domains use bounded representative generation (boundary values, absent/optional, null, enum and type cases), clearly marked **sampled**, not exhaustive. Use only cases allowed by the source contract; use valid baselines and shrink counterexamples when possible. Report generation seed, budget, coverage limitations and unsupported features. If no valid cases can be generated, report Warning, not success.
5. Optionally add sound schema-containment checks for a clearly defined subset. Only report **contract compatible** when exhaustive enumeration or a sound containment check establishes it for the declared supported scope. Otherwise report Warning. Report **incompatible** only with a valid source-side counterexample that the target contract rejects, identifying endpoint, direction, status/media type, data path, reason and example.
6. No actual API calls or mutations in this phase; evaluate against stored API definitions. The simulated receiver does not validate actual provider behavior. Keep all schema evaluation resource-bounded and safe for untrusted contracts.

### Integration and UI

- Extend the current on-demand analysis model and service-definition analysis endpoint with a distinct variation result per API revision and per operation, without silently changing the structural status or using diff output as compatibility evidence.
- In the registry graph side panel show **Structural** and **Contract variations** separately, with compatible / incompatible / warning status, source assumptions, exhaustive versus sampled coverage, checked counts, and expandable actionable counterexamples. No case data should be sent to a real provider.
- Keep the graph's current structural-match edge behavior explicit; variation success must not be inferred from an existing green edge. If any combined label is later introduced, show compatibility only when all required checks are established, and handle unknown independently from definite incompatibility.
- Define behavior for older stored definitions, same-name legacy revisions, refreshes, multiple services, resource limits, and failures. Avoid logging sensitive values; contracts and generated examples should contain synthetic data only.

### Verification and acceptance

- Unit tests: request and response direction; required/optional and omitted bodies; nullable values; enums, numeric bounds, arrays, extra properties, correlated alternatives, path/status/media mismatches; local refs; OpenAPI 3.0/3.1 differences; unsupported and invalid schemas; and valid minimal counterexamples.
- Coverage tests: finite complete enumeration, representative sampling, deterministic seeds, zero cases, over-budget/truncated generation, cycles and termination. Verify none can produce a false compatible result when coverage is incomplete.
- Integration tests: upload old and extended service YAML, reload from MongoDB, analyze across multiple APIs and revisions, service ownership, endpoint errors, and backwards compatibility. Browser tests verify separate statuses and details for services and revisions.
- Update README with schema examples, exact supported semantics, limits, API response changes, and the difference between contract compatibility and actual service/provider behavior. Run lint, typecheck, build and relevant unit, integration and UI suites.

### Decisions to confirm

- Where will service-side request/response contracts come from: manually authored YAML, generated from service code/tests, or another source? Existing `sends` / `reads` are insufficient for exhaustive variation generation.
- What schema dialect and bounded case/time limits should the initial release support? Proposed first scope: JSON bodies, local refs and a documented conservative subset; mark everything else Warning.
- Should cases be returned on demand only, or should generated results be stored? Proposed default: on demand, with summaries and bounded counterexamples.

## 5. API Version Runtime Health Checks — Paused

### Goal

Provision runnable endpoints for each API version in a webhook receiver, then check their availability on upload, every three minutes, and on demand. Show runtime health alongside, but separately from, the existing YAML-based service analysis.

**Implemented so far:** A separate authenticated contract receiver accepts YAML over WebSocket and provides persistent, isolated simulated endpoints. API uploads attempt provisioning; an endpoint can retry provisioning for existing versions. The original notification receiver is unchanged. See the README for configuration and supported path syntax.

**Still planned:** Provisioning status persistence and bulk backfill, automatic and manual checks, scheduling, and health labels in the registry graph. Simulated endpoints only demonstrate receiver availability, not the health of a deployed API.

### Proposed flow

1. **Upload and provision:** Validate and store the API version, run the existing structural analysis, and send its definition to the receiver using the API and version record IDs. Track provisioning as pending, successful, or failed, then run an initial check after successful provisioning. Keep the uploaded version if the receiver is unavailable and allow provisioning to be retried.
2. **Existing versions:** Provide an idempotent backfill operation to register existing versions independently by record ID. Skip successful registrations unless explicitly retried, and report failures without stopping the entire backfill.
3. **Runtime checks:** Check provisioned versions every three minutes and provide a manual check action. Prevent overlapping checks for a version. Store the latest result, check time, endpoint-level details, and errors. Mark results stale when checks stop running; distinguish pending, not checked, provisioning failure, check failure, partial health, and healthy states.
4. **Graph and details:** Show separate YAML analysis and runtime health labels and details for each service-to-version connection. Provide manual check and provisioning retry controls, and refresh health status without a full page reload. A reachable receiver endpoint must not be presented as proof of service compatibility or real API health.
5. **Persistence and APIs:** Persist provisioning and health records keyed by API version ID. Add endpoints for provisioning, backfill, manual checks, and results. Include stored health summaries in graph responses without live network calls during graph loading.
6. **Scheduling and security:** Use a reliable background worker or external scheduled job rather than a timer in a Next.js request handler. Add timeouts, bounded concurrency, retries, and coordination across app instances. Define receiver authentication, idempotency, and a restricted receiver address to prevent arbitrary outbound requests.
7. **Verification:** Test provisioning, retries, backfill, scheduled and manual checks, receiver downtime, partial failures, stale results, duplicate job prevention, and graph presentation using a controlled test receiver.

### Decisions needed before implementation

- Should the receiver provide a non-mutating probe interface, or must checks invoke generated endpoints directly? Direct calls may require credentials, parameters, and bodies or cause side effects.
- Where will Contract Guard run, and can it run a persistent worker or external scheduled job?
