# Contract Guard — Completed Phases

This document records the phases completed in this session and the scope of the current implementation. See [README.md](README.md) for setup, endpoints, and test commands.

## 1. The Foundation — Complete

Established the Next.js application, MongoDB-backed registry, and the API and service workflows. Registry identities and their uploaded revisions are stored separately, with validators, indexes, source hashes, timestamps, and unique record IDs. API and service entries can be created, listed, and viewed through the UI and registry endpoints.

## 2. API/Service YAML to JSON Parse and View — Complete

API OpenAPI YAML and service consumer YAML can be uploaded, validated for their core structure, parsed into JSON-compatible documents, and stored as revisions. API versions come from `info.version` or an explicitly supplied version; service definitions are unversioned revisions. Original document fields and source metadata are retained.

The UI provides an expandable definition tree. For services, declared uses are also grouped by API provider, then by endpoint, with sent and read fields and additional details. The complete definition remains available.

## 3. API Version Diff Analysis Creation and Persistence — Complete within current scope

The diff service compares any two distinct revisions of the same API and reports structural changes, categorized by parameters, request bodies, responses, schemas, components, paths, and other fields. Changes include before/after values when applicable and are capped at 5,000 with a truncation indicator. The API detail view connects adjacent revisions in upload order; selecting an edge opens a filterable comparison panel. Same-version revisions remain distinct by record ID.

**Persistence distinction:** uploaded API revisions are persisted, but diff results are calculated on demand and are **not persisted** as separate records. The comparison is structural; it does not resolve `$ref` or determine whether changes are breaking.

## 4. Service Safety Matching to API Versions — Complete within current scope

Service definitions are analyzed against each registered revision of their declared API providers. The analysis checks exact endpoints and methods, parameters, request and response fields, required fields, and supported local `$ref` references. Results include reasons and are classified as a structural match, incompatible, or unknown; the UI displays unknown as **Warning**.

The registry overview presents service nodes and API boxes containing revisions. Connections lead to structurally matching revisions; dependencies without a confirmed match use dashed connections. Selecting a service highlights its edges and filters the side panel. Users can inspect revision results, drag nodes, and pan or zoom the canvas. The overview analyzes the latest uploaded service definition; an endpoint is available to analyze a specific historical definition.

**Scope distinction:** matching compares the service definition directly with each API revision; it does **not** use the version diff output or identify a service's actual deployed API version. Analysis and connections are calculated on demand, not persisted as bindings. A structural match is not a runtime safety guarantee: consumer definitions do not specify types, values, credentials, expected response statuses, or deployment details, and unsupported or ambiguous constructs may yield a warning.

## Remaining limitations

- Persisted diff records, explicit service-to-version binding management, and actual deployed-version tracking are not implemented.
- Full OpenAPI validation, authentication, and runtime compatibility verification are not implemented.
- Graph positions are temporary and reset on refresh; separate edge routes reduce overlap but may still cross.
