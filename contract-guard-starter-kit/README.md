# Contract Guard starter kit

Everything you need to build **Contract Guard**, the API contract registry. Read the problem statement first.

## Start the kit

From this folder:

- **Docker:** `docker compose up --build`
- **Podman:** `podman compose up --build` (needs `podman compose` or `podman-compose`)

This starts a **webhook receiver** at http://localhost:9900. It stands in for chat and email: anything POSTed to it appears on its page. `GET /api/received` returns the list as JSON, and `DELETE /api/received` clears it. If port 9900 is already in use, start the kit with another port, for example `WEBHOOK_PORT=9950 docker compose up --build`.

Everything else in the kit is plain files.

## API specifications: `specs/`

Three provider services, each with four versions of its OpenAPI 3.0.3 specification, numbered in the order the owning team wants to publish them:

| Service | Owner | Files |
| --- | --- | --- |
| `quote-api` | Quotes team | `specs/quote-api/1-initial.yaml` … `4-ncb-and-taxes.yaml` |
| `policy-api` | Policy team | `specs/policy-api/1-initial.yaml` … `4-endorsement-rules.yaml` |
| `claims-api` | Claims team | `specs/claims-api/1-initial.yaml` … `4-approval-later.yaml` |

- The version number of each specification is in `info.version`.
- Specifications reuse components through `$ref`. All references point inside the same file.
- Some specifications mark operations or fields with extensions such as `x-internal` and `x-sunset`. Ask the product owner what they mean.
- Some versions contain problems you'll want Contract Guard to catch.

## Consumers: `consumers/`

One YAML file per service that calls these APIs: `mobile-app`, `partner-portal`, `payments-svc` and `notifications-svc`. Each file says which endpoints the service calls, what it sends, and what it reads:

```yaml
consumer: mobile-app
team: Mobile
uses:
  - provider: quote-api
    method: POST
    path: /quotes
    sends: [vehicle.make, vehicle.cc, rider.age]      # request fields and parameters it sends
    reads: [quoteId, premium.breakdown[].amount]      # response fields it reads
```

Field paths use dots for nested fields and `[]` for items in a list. Consumer files describe what each service used when the file was written; the specs may have moved on since.

## Rules

- **Don't change the files in `specs/` or `consumers/`**: the evaluators test your product against the original kit. Copy them if you want to experiment.
- How Contract Guard reads these files (upload through your API or UI, import from the folder, or both) is your decision.
