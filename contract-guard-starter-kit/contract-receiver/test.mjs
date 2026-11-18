import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import WebSocket from "ws";

const token = "test-secret-at-least-16";
const apiId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const versionId = "bbbbbbbbbbbbbbbbbbbbbbbb";
const otherId = "cccccccccccccccccccccccc";
const yaml = `openapi: 3.0.3
info:
  title: Test
  version: 1.0.0
paths:
  /items/{id}:
    get:
      operationId: getItem
      responses:
        '200': {description: OK}
  /items:
    post:
      requestBody: {required: true}
      responses:
        '201': {description: Created}
`;

test("WebSocket provisioning creates isolated, persistent simulated endpoints", async () => {
  const dir = await mkdtemp(join(tmpdir(), "contract-receiver-"));
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  let child;
  async function start() {
    child = spawn(process.execPath, ["server.mjs"], { cwd: import.meta.dirname, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", RECEIVER_TOKEN: token, DATA_DIR: dir } });
    const [chunk] = await once(child.stdout, "data");
    assert.match(String(chunk), /listening/);
  }
  async function stop() { child.kill(); await once(child, "exit"); }
  async function provision(data, auth = token) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Authorization: `Bearer ${auth}` } });
    await once(ws, "open");
    ws.send(JSON.stringify({ type: "provision", requestId: "test", apiId, versionId, yaml, ...data }));
    const [raw] = await once(ws, "message"); ws.close();
    return JSON.parse(raw.toString());
  }
  const get = (path, options = {}) => fetch(`http://127.0.0.1:${port}${path}`, { ...options, headers: { Authorization: `Bearer ${token}` } });
  try {
    await start();
    assert.equal((await fetch(`http://127.0.0.1:${port}/contracts/${apiId}/${versionId}`)).status, 401);
    assert.equal((await provision({})).data.endpoints.length, 2);
    assert.equal((await provision({})).ok, true);
    assert.equal((await provision({ yaml: yaml.replace("getItem", "different") })).ok, false);
    assert.equal((await provision({ versionId: otherId, yaml: yaml.replace("1.0.0", "2.0.0").replace("/items/{id}", "/other/{id}") })).ok, true);
    const details = await (await get(`/contracts/${apiId}/${versionId}`)).json();
    assert.equal(details.endpoints.find((endpoint) => endpoint.method === "GET").operation.responses["200"].description, "OK");
    const response = await get(`/mock/${apiId}/${versionId}/items/123`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).operationId, "getItem");
    assert.equal((await get(`/mock/${apiId}/${versionId}/items`, { method: "POST" })).status, 200);
    assert.equal((await get(`/mock/${apiId}/${versionId}/items`)).status, 405);
    assert.equal((await get(`/mock/${apiId}/${otherId}/items/123`)).status, 404);
    assert.equal((await get(`/mock/${"d".repeat(24)}/${versionId}/items/123`)).status, 404);
    assert.equal((await provision({ versionId: "dddddddddddddddddddddddd", yaml: yaml.replace("/items:", "/items/{other}:") })).ok, true);
    await stop(); await start();
    assert.equal((await get(`/mock/${apiId}/${versionId}/items/123`)).status, 200);
    assert.equal((await provision({})).ok, true);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
