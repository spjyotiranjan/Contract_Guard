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
  assert.equal((await request(`/api/apis/${apiId}/versions`)).body.data.length, 1);
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
  console.log("Registry HTTP checks passed.");
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
