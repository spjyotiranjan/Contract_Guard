import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { compareDefinitions } from "../src/lib/diff/compare";
import type { JsonObject } from "../src/lib/registry/types";

async function main() {
  const fixture = async (file: string) => parse(await readFile(file, "utf8")) as JsonObject;
  const oldClaims = await fixture("specs/claims-api/2-channel-and-notes.yaml");
  const fixedClaims = await fixture("specs/claims-api/3-channel-and-notes-fixed.yaml");
  const fix = compareDefinitions(oldClaims, fixedClaims);
  assert.equal(fix.changes.length, 1);
  assert.equal(fix.changes[0].category, "schemas");
  assert.equal(fix.changes[0].before, "#/components/schemas/ClaimDocumnt");
  assert.equal(fix.changes[0].after, "#/components/schemas/ClaimDocument");
  const quoteInitial = await fixture("specs/quote-api/1-initial.yaml");
  const quoteReorganised = await fixture("specs/quote-api/2-reorganised.yaml");
  const quoteDiff = compareDefinitions(quoteInitial, quoteReorganised);
  assert.ok(quoteDiff.changes.some((change) => change.category === "paths" && change.action === "removed" && change.path.includes("/quotes/{id}")));
  assert.ok(quoteDiff.changes.some((change) => change.category === "schemas"));

  const oldApi: JsonObject = { paths: { "/x": { get: { parameters: [{ in: "query", name: "a", required: false }, { in: "query", name: "b" }], responses: { "200": { description: "old" } } } } }, components: { schemas: { Item: { required: ["x", "y"], enum: ["one", "two"] } } }, value: null };
  const newApi: JsonObject = { paths: { "/x": { get: { parameters: [{ in: "query", name: "b" }, { in: "query", name: "a", required: true }], responses: { "200": { description: "new" } }, requestBody: { required: true } } } }, components: { schemas: { Item: { required: ["y", "x"], enum: ["two", "one"] } } }, value: false };
  const diff = compareDefinitions(oldApi, newApi);
  assert.equal(diff.changes.length, 4);
  assert.ok(diff.changes.some((change) => change.category === "parameters" && change.before === false && change.after === true));
  assert.ok(diff.changes.some((change) => change.category === "responses" && change.before === "old" && change.after === "new"));
  assert.ok(diff.changes.some((change) => change.category === "request" && change.action === "added"));
  assert.ok(diff.changes.some((change) => change.before === null && change.after === false));
  const components = compareDefinitions({ components: { responses: { Shared: { description: "old" } } } }, { components: { responses: { Shared: { description: "new" } } } });
  assert.equal(components.changes[0].category, "components");
  assert.equal(compareDefinitions(newApi, newApi).changes.length, 0);
  const many: JsonObject = {}; for (let index = 0; index < 5002; index++) many[`key${index}`] = index;
  const limit = compareDefinitions({}, many);
  assert.equal(limit.changes.length, 5000);
  assert.equal(limit.truncated, true);
  console.log("Version diff unit checks passed.");
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
