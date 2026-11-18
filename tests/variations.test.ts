import assert from "node:assert/strict";
import { analyzeVariations } from "../src/lib/analysis/variations";
import { validateService } from "../src/lib/registry/parse";
import type { JsonObject, ServiceUse } from "../src/lib/registry/types";

const bool = { type: "boolean" };
const consumerBody = { type: "object", properties: { a: bool, b: bool }, required: ["a"], additionalProperties: false };
const apiBody = { type: "object", properties: { a: bool, b: bool }, required: ["a"], additionalProperties: false };
const responseBody = { type: "object", properties: { ok: bool }, required: ["ok"], additionalProperties: false };
function spec(request: unknown = apiBody, response: unknown = responseBody): JsonObject {
  return { openapi: "3.0.3", paths: { "/x": { post: { requestBody: { required: true, content: { "application/json": { schema: request } } }, responses: { "200": { content: { "application/json": { schema: response } } } } } } } } as JsonObject;
}
function service(request: unknown = consumerBody, response: unknown = responseBody): ServiceUse {
  return { provider: "api", method: "POST", path: "/x", sends: [], reads: [], contract: { version: 1, request: { body: "required", schema: request }, responses: { "200": { body: "optional", schema: response } } } } as ServiceUse;
}
function main() {
  const result = analyzeVariations(spec(), [service()]);
  assert.equal(result.status, "match");
  assert.equal(result.checks[0].checked, 6);
  assert.equal(result.checks[1].checked, 2);
  assert.equal(result.checks[0].coverage, "exhaustive");
  const missingRequired = analyzeVariations(spec({ ...apiBody, required: ["a", "b"] }), [service()]);
  assert.equal(missingRequired.status, "incompatible");
  assert.deepEqual(missingRequired.checks[0].example, { a: false });
  const responseMismatch = analyzeVariations(spec(), [service(consumerBody, { ...responseBody, properties: { ok: { type: "boolean", enum: [true] } } })]);
  assert.equal(responseMismatch.checks[1].status, "incompatible");
  assert.deepEqual(responseMismatch.checks[1].example, { ok: false });
  assert.equal(analyzeVariations(spec({ type: "string" }), [service({ type: "string" })]).checks[0].coverage, "sampled");
  assert.equal(analyzeVariations(spec({ type: "string" }), [service({ type: "string" })]).checks[0].status, "unknown");
  const open = { type: "object", properties: { a: bool }, required: ["a"] };
  assert.equal(analyzeVariations(spec(open), [service(open)]).checks[0].status, "unknown");
  const nullable = analyzeVariations(spec({ type: "boolean" }), [service({ type: "boolean", nullable: true })]);
  assert.equal(nullable.checks[0].status, "incompatible");
  assert.equal(nullable.checks[0].example, null);
  const optional = service(); (optional.contract as JsonObject).request = { body: "optional", schema: consumerBody };
  assert.equal(analyzeVariations(spec(), [optional]).checks[0].message, "Service may omit a body that the API requires.");
  const array = { type: "array", items: bool, minItems: 0, maxItems: 2 };
  assert.equal(analyzeVariations(spec(array), [service(array)]).checks[0].checked, 7);
  const big = { type: "array", items: bool, maxItems: 20 };
  assert.equal(analyzeVariations(spec(big), [service(big)]).checks[0].status, "unknown");
  const oversizedOptional = { type: "object", properties: { large: { type: "array", items: bool, minItems: 6 } }, additionalProperties: false };
  assert.equal(analyzeVariations(spec(oversizedOptional), [service(oversizedOptional)]).checks[0].status, "unknown");
  const refApi = spec({ $ref: "#/components/schemas/Body" }); refApi.components = { schemas: { Body: apiBody } };
  assert.equal(analyzeVariations(refApi, [service()]).checks[0].status, "match");
  assert.equal(analyzeVariations(spec({ oneOf: [apiBody] }), [service()]).checks[0].status, "unknown");
  const legacy = { provider: "api", method: "POST", path: "/x", sends: [], reads: [] } as ServiceUse;
  assert.equal(analyzeVariations(spec(), [legacy]).status, "unknown");
  const legacyFields = { ...legacy, sends: ["a", "b"], reads: ["ok"] };
  const estimated = analyzeVariations(spec(), [legacyFields]);
  assert.equal(estimated.checks[0].checked, 4);
  assert.equal(estimated.checks[1].checked, 2);
  assert.equal(estimated.checks[0].status, "unknown");
  assert.match(estimated.checks[0].message, /hypothetical/);
  assert.deepEqual(estimated.checks[0].example, { present: [], omitted: ["a", "b"], reason: "API requires a request body; body presence is not specified by sends." });
  const document = { consumer: "test", team: "t", uses: [service()] } as JsonObject;
  assert.equal(validateService(document, "test").uses.length, 1);
  assert.throws(() => validateService({ consumer: "test", team: "t", uses: [{ ...service(), contract: { version: 1, request: { body: "optional" } } }] }, "test"), /schema/);
  console.log("Contract variation checks passed.");
}
main();
