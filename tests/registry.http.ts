import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const base = process.env.TEST_BASE_URL;
if (!base) throw new Error("Set TEST_BASE_URL to a running test app. This test writes registry data.");

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, init);
  return { status: response.status, body: await response.json() };
}
function json(value: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
}
function upload(content: string, version?: string, name = "definition.yaml"): RequestInit {
  const data = new FormData();
  data.append("file", new File([content], name));
  if (version !== undefined) data.append("version", version);
  return { method: "POST", body: data };
}

async function main() {
  const suffix = randomUUID();
  const invalid = await request("/api/apis", json({ name: " ", owner: "team" }));
  assert.equal(invalid.status, 400);
  assert.equal((await request("/api/apis/not-an-id")).status, 400);
  assert.equal((await request("/api/apis/000000000000000000000000")).status, 404);

  const api = await request("/api/apis", json({ name: `quote-api-${suffix}`, owner: "Quotes" }));
  assert.equal(api.status, 201);
  const apiId = api.body.data._id;
  assert.equal((await request("/api/apis", json({ name: `quote-api-${suffix}`, owner: "Quotes" }))).status, 409);
  const spec = await readFile("specs/quote-api/1-initial.yaml", "utf8");
  assert.equal((await request(`/api/apis/${apiId}/versions`, upload(spec, "2.0.0"))).status, 400);
  assert.equal((await request(`/api/apis/${apiId}/versions`, upload("invalid: [", "1.0.0"))).status, 400);
  const created = await request(`/api/apis/${apiId}/versions`, upload(spec));
  assert.equal(created.status, 201);
  assert.equal(created.body.data.definition.info.version, "1.0.0");
  assert.equal((await request(`/api/apis/${apiId}/versions`, upload(spec, "1.0.0"))).status, 409);
  const duplicate = await request(`/api/apis/${apiId}/versions`, upload(spec + "\n# changed source\n"));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, "This API version already exists.");
  assert.equal((await request(`/api/apis/${apiId}/versions`, upload(spec.replace("  version: 1.0.0\n", ""), "1.0.0"))).status, 409);
  const concurrentSpec = spec.replace("version: 1.0.0", "version: 4.0.0");
  const concurrent = await Promise.all([request(`/api/apis/${apiId}/versions`, upload(concurrentSpec)), request(`/api/apis/${apiId}/versions`, upload(concurrentSpec + "\n# different\n"))]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), [201, 409]);
  assert.equal((await request(`/api/apis/${apiId}/versions`)).body.data.length, 2);
  assert.equal((await request(`/api/apis/${apiId}/versions/${created.body.data._id}`)).status, 200);
  const noVersion = spec.replace("  version: 1.0.0\n", "");
  assert.equal((await request(`/api/apis/${apiId}/versions`, upload(noVersion))).status, 400);
  const supplied = await request(`/api/apis/${apiId}/versions`, upload(noVersion, "3.0.0"));
  assert.equal(supplied.status, 201);
  assert.equal(supplied.body.data.version, "3.0.0");
  assert.equal(supplied.body.data.definition.info.version, "3.0.0");
  assert.equal((await request(`/api/apis/${apiId}/versions`, upload(spec.replace("version: 1.0.0", "version: 123"), "1.0.0"))).status, 400);
  const comparison = await request(`/api/apis/${apiId}/diff?from=${created.body.data._id}&to=${supplied.body.data._id}`);
  assert.equal(comparison.status, 200);
  assert.ok(comparison.body.data.changes.some((change: { path: string[]; before?: unknown; after?: unknown }) => change.path.join("/") === "info/version" && change.before === "1.0.0" && change.after === "3.0.0"));
  assert.equal((await request(`/api/apis/${apiId}/diff?from=${created.body.data._id}&to=${created.body.data._id}`)).status, 400);
  assert.equal((await request(`/api/apis/${apiId}/diff?from=bad&to=${created.body.data._id}`)).status, 400);
  assert.equal((await request(`/api/apis/${apiId}/diff?from=${created.body.data._id}&to=000000000000000000000000`)).status, 404);
  const otherApi = await request("/api/apis", json({ name: `other-api-${suffix}`, owner: "Other" }));
  const otherVersion = await request(`/api/apis/${otherApi.body.data._id}/versions`, upload(spec));
  assert.equal(otherVersion.status, 201);
  assert.equal((await request(`/api/apis/${apiId}/diff?from=${created.body.data._id}&to=${otherVersion.body.data._id}`)).status, 404);

  const serviceName = `mobile-app-${suffix}`;
  const service = await request("/api/services", json({ name: serviceName, owner: "Mobile" }));
  assert.equal(service.status, 201);
  const serviceId = service.body.data._id;
  const source = await readFile("consumers/mobile-app.yaml", "utf8");
  assert.equal((await request(`/api/services/${serviceId}/definitions`, upload(source))).status, 400);
  const yaml = source.replace("consumer: mobile-app", `consumer: ${serviceName}`);
  assert.equal((await request(`/api/services/${serviceId}/definitions`, upload(yaml, "1.0"))).status, 400);
  const saved = await request(`/api/services/${serviceId}/definitions`, upload(yaml));
  assert.equal(saved.status, 201);
  assert.equal(saved.body.data.definition.uses.length, 4);
  assert.equal(saved.body.data.version, undefined);
  assert.equal((await request(`/api/services/${serviceId}/definitions`, upload(yaml))).status, 409);
  assert.equal((await request(`/api/services/${serviceId}/definitions`)).body.data.length, 1);
  assert.equal((await request(`/api/services/${serviceId}/definitions/${saved.body.data._id}`)).status, 200);
  assert.equal((await request(`/api/apis/${apiId}/versions/${saved.body.data._id}`)).status, 404);
  assert.equal((await request(`/api/apis/${apiId}/diff?from=${created.body.data._id}&to=${saved.body.data._id}`)).status, 404);
  const graph = await request("/api/registry/graph");
  assert.equal(graph.status, 200);
  const missing = graph.body.data.connections.find((connection: { serviceId: string; provider: string }) => connection.serviceId === serviceId && connection.provider === "quote-api");
  assert.ok(missing);
  assert.equal(missing.apiId, undefined);
  const declared = await request(`/api/services/${serviceId}/definitions/${saved.body.data._id}/analysis`);
  assert.equal(declared.status, 200);
  assert.equal(declared.body.data.length, 2);
  assert.equal((await request(`/api/services/${serviceId}/definitions/000000000000000000000000/analysis`)).status, 404);
  const registeredProvider = await request("/api/apis", json({ name: `provider-${suffix}`, owner: "Test" }));
  const providerService = await request("/api/services", json({ name: `consumer-${suffix}`, owner: "Test" }));
  const simpleSpec = `openapi: 3.0.3\ninfo:\n  title: Test\n  version: 1.0.0\npaths:\n  /ping:\n    get:\n      responses:\n        '200':\n          description: ok\n`;
  const simpleVersion = await request(`/api/apis/${registeredProvider.body.data._id}/versions`, upload(simpleSpec));
  const simpleService = await request(`/api/services/${providerService.body.data._id}/definitions`, upload(`consumer: consumer-${suffix}\nteam: Test\nuses:\n- provider: provider-${suffix}\n  method: GET\n  path: /ping\n  sends: []\n  reads: []\n`));
  const matching = await request(`/api/services/${providerService.body.data._id}/definitions/${simpleService.body.data._id}/analysis`);
  assert.equal(matching.body.data[0].versions[0].versionId, simpleVersion.body.data._id);
  assert.equal(matching.body.data[0].versions[0].status, "match");
  assert.equal(matching.body.data[0].versions[0].variations.status, "unknown");
  const badSpec = simpleSpec.replace("version: 1.0.0", "version: 2.0.0").replace("/ping:", "/other:");
  await request(`/api/apis/${registeredProvider.body.data._id}/versions`, upload(badSpec));
  const revised = await request(`/api/services/${providerService.body.data._id}/definitions/${simpleService.body.data._id}/analysis`);
  assert.equal(revised.body.data[0].versions.length, 2);
  assert.equal(revised.body.data[0].versions[1].status, "incompatible");
  const graphRevised = await request("/api/registry/graph");
  const matchedConnection = graphRevised.body.data.connections.find((connection: { serviceId: string }) => connection.serviceId === providerService.body.data._id);
  assert.equal(matchedConnection.versions.length, 2);
  const newerService = await request(`/api/services/${providerService.body.data._id}/definitions`, upload(`consumer: consumer-${suffix}\nteam: Test\nuses:\n- provider: missing-${suffix}\n  method: GET\n  path: /ping\n  sends: []\n  reads: []\n`));
  assert.equal(newerService.status, 201);
  const latestGraph = await request("/api/registry/graph");
  const latestConnection = latestGraph.body.data.connections.find((connection: { serviceId: string }) => connection.serviceId === providerService.body.data._id);
  assert.equal(latestConnection.definitionId, newerService.body.data._id);
  assert.equal(latestConnection.provider, `missing-${suffix}`);
  assert.equal((await request(`/api/services/${providerService.body.data._id}/definitions/${simpleService.body.data._id}/analysis`)).body.data[0].provider, `provider-${suffix}`);
  const variantName = `variant-${suffix}`;
  const variantService = await request("/api/services", json({ name: variantName, owner: "Test" }));
  const variantSpec = `openapi: 3.0.3\ninfo: {title: Test, version: 3.0.0}\npaths:\n  /variant:\n    post:\n      requestBody:\n        required: true\n        content:\n          application/json:\n            schema:\n              type: object\n              required: [flag]\n              additionalProperties: false\n              properties:\n                flag: {type: boolean}\n      responses:\n        '200':\n          description: ok\n          content:\n            application/json:\n              schema: {type: boolean}\n`;
  assert.equal((await request(`/api/apis/${registeredProvider.body.data._id}/versions`, upload(variantSpec))).status, 201);
  const variantYaml = `consumer: ${variantName}\nteam: Test\nuses:\n- provider: provider-${suffix}\n  method: POST\n  path: /variant\n  sends: [flag]\n  reads: []\n  contract:\n    version: 1\n    request:\n      body: required\n      schema:\n        type: object\n        properties:\n          flag: {type: boolean}\n        additionalProperties: false\n    responses:\n      '200':\n        body: optional\n        schema: {type: boolean}\n`;
  const variantDefinition = await request(`/api/services/${variantService.body.data._id}/definitions`, upload(variantYaml));
  assert.equal(variantDefinition.status, 201);
  const variantAnalysis = await request(`/api/services/${variantService.body.data._id}/definitions/${variantDefinition.body.data._id}/analysis`);
  const variantResult = variantAnalysis.body.data[0].versions.find((version: { version: string }) => version.version === "3.0.0").variations;
  assert.equal(variantResult.status, "incompatible");
  assert.deepEqual(variantResult.checks[0].example, {});
  assert.equal((await request(`/api/services/${variantService.body.data._id}/definitions`, upload(variantYaml.replace("version: 1", "version: 2")))).status, 400);
  console.log("Registry HTTP checks passed.");
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
