import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { analyzeUses } from "../src/lib/analysis/analyze";
import type { JsonObject, ServiceDefinition, ServiceUse } from "../src/lib/registry/types";

async function main() {
  const load = async (path: string) => parse(await readFile(path, "utf8"));
  const service = await load("consumers/mobile-app.yaml") as ServiceDefinition;
  const quote = await load("specs/quote-api/1-initial.yaml") as JsonObject;
  const quoteUses = service.uses.filter((use) => use.provider === "quote-api");
  const initial = analyzeUses(quote, quoteUses);
  assert.equal(initial.status, "match");
  const changed = analyzeUses(await load("specs/quote-api/2-reorganised.yaml"), quoteUses);
  assert.equal(changed.status, "incompatible");
  assert.ok(changed.issues.some((issue) => issue.code === "endpoint_missing"));
  const payments = await load("consumers/payments-svc.yaml") as ServiceDefinition;
  const policy = analyzeUses(await load("specs/policy-api/3-remove-old-fields.yaml"), payments.uses);
  assert.equal(policy.status, "incompatible");
  assert.ok(policy.issues.some((issue) => issue.field === "legacyCode"));

  const use: ServiceUse = { provider: "test", method: "POST", path: "/items", sends: ["item.name"], reads: ["id"] };
  const schema: JsonObject = { paths: { "/items": { post: { requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["item"], properties: { item: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } } } } }, responses: { "200": { content: { "application/json": { schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } } } } } } } } } };
  assert.equal(analyzeUses(schema, [use]).status, "match");
  assert.equal(analyzeUses(schema, [{ ...use, sends: ["item.other"] }]).status, "incompatible");
  assert.equal(analyzeUses(schema, [{ ...use, reads: ["missing"] }]).status, "incompatible");
  assert.equal(analyzeUses({ paths: { "/items": { post: { requestBody: { $ref: "#/missing" }, responses: { "200": { description: "ok" } } } } } }, [use]).status, "unknown");
  const optional = JSON.parse(JSON.stringify(schema)) as JsonObject;
  const paths = optional.paths as Record<string, unknown>;
  const operation = ((paths["/items"] as Record<string, unknown>).post as Record<string, unknown>);
  operation.security = [{ key: [] }];
  assert.equal(analyzeUses(optional, [use]).status, "unknown");
  const external = JSON.parse(JSON.stringify(schema)) as JsonObject;
  const externalOperation = (((external.paths as Record<string, unknown>)["/items"] as Record<string, unknown>).post as Record<string, unknown>);
  externalOperation.parameters = [{ in: "header", name: "x-id", required: true, schema: { $ref: "https://example.com/schema" } }];
  assert.equal(analyzeUses(external, [{ ...use, sends: ["item.name", "x-id"] }]).status, "unknown");
  console.log("Compatibility analysis checks passed.");
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
