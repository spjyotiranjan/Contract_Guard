# Contract Guard progress

Snapshot taken on 18 November 2026. The local Git history ends at `0528245`. The working tree also contains the simulated contract receiver and its registry integration. See [README.md](README.md) for setup and [Plan.md](Plan.md) for the proposed runtime health workflow.

## Commit history

| Commit | What shipped |
| --- | --- |
| `f699aea` | Added the Next.js app, MongoDB registry and validators, API and service YAML uploads, definition viewer, structural API diff, sample contracts, and initial tests. |
| `b82b042` | Grouped declared service usage by API provider and endpoint, with separate views of sent and read fields. |
| `8222487` | Added service-to-version structural analysis, the dependency graph, analysis APIs, and test coverage. Introduced `Plan.md`. |
| `4961e24` | Enforced unique version labels per API through the repository and a MongoDB index. Duplicate uploads return `409`. |
| `0528245` | Added the starter kit's Docker Compose setup and Python notification webhook, and recorded the runtime health phase in the plan. |

## Current implementation

- **Registry and uploads.** MongoDB stores API and service identities separately from their uploaded revisions. The registry retains parsed definitions, source hashes, and filenames. The UI supports creation, upload, and inspection. [Registry implementation](src/lib/registry)
- **API comparison.** The version timeline follows upload order. The diff endpoint compares any two revisions of the same API, groups structural changes, and returns before and after values where applicable. Results are computed on demand. [Diff implementation](src/lib/diff)
- **Service analysis.** The latest service definitions drive the graph. A separate endpoint evaluates historical definitions. Analysis reports `match`, `incompatible`, or `unknown` with reasons where available. The graph represents declared usage and structural compatibility. [Analysis implementation](src/lib/analysis)
- **Notification webhook.** The starter kit runs a Docker inbox for test notifications, with an HTML view and a JSON API. Inbound messages are held in memory. [Webhook receiver](contract-guard-starter-kit/webhook-receiver/app.py)

## In the working tree

The optional Node.js contract receiver accepts authenticated WebSocket provisioning requests and persists generated route definitions. Uploading an API version saves it first and then attempts provisioning. An explicit retry route handles existing versions. The upload UI reports the outcome. Docker Compose exposes the mock receiver on localhost through the `contracts` profile. [Registry provisioning](src/lib/receiver/provision.ts) · [Receiver server](contract-guard-starter-kit/contract-receiver/server.mjs)

## Verification

- The production build, lint, type checking, the diff and analysis suites, and both receiver test suites passed on this working tree.
- The earlier review passed the HTTP and browser suites against an isolated MongoDB. In that review, the MongoDB integration suite stopped in the legacy fixture because two fixture documents shared an `_id`, before it reached the duplicate-version migration assertion. [Integration fixture](tests/registry.integration.ts#L52)
- The analyzer review reproduced a false structural match when the consumer sends part of an optional nested object and omits a required field inside that object. [Request validation](src/lib/analysis/analyze.ts#L64)

## Pending

- Store provisioning outcomes, backfill existing API versions, run on-demand and scheduled checks, and show simulated endpoint health in the graph. The health phase still needs a probe design and a scheduling environment.
- Add explicit service-to-version binding management and deployed-version tracking. Add a sender if Contract Guard needs to deliver notifications to the starter-kit inbox.
- Address the integration fixture and nested-field analysis cases. Keep the two Claims `1.1.0` fixtures in mind when testing uploads.
