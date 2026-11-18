import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectId } from "mongodb";
import { provisionVersion } from "../src/lib/receiver/provision";
import type { ApiVersion } from "../src/lib/registry/types";

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "contract-backend-test-"));
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const token = "test-secret-at-least-16";
  const child = spawn(process.execPath, ["server.mjs"], { cwd: "contract-guard-starter-kit/contract-receiver", env: { ...process.env, PORT: String(port), RECEIVER_TOKEN: token, DATA_DIR: dir } });
  const record: ApiVersion = { _id: new ObjectId(), apiId: new ObjectId(), version: "1.2.0", sourceHash: "a".repeat(64), createdAt: new Date(), definition: { openapi: "3.0.3", info: { title: "Test", version: "1.2.0" }, paths: { "/ping": { get: { responses: { "200": { description: "ok" } } } } } } };
  try {
    await once(child.stdout!, "data");
    process.env.CONTRACT_RECEIVER_WS_URL = `ws://127.0.0.1:${port}/ws`;
    process.env.CONTRACT_RECEIVER_TOKEN = token;
    const result = await provisionVersion(record);
    if (result.status !== "provisioned") throw new Error(result.message);
    assert.equal(result.endpointCount, 1);
    const response = await fetch(`http://127.0.0.1:${port}${result.basePath}/ping`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).simulated, true);
    process.env.CONTRACT_RECEIVER_TOKEN = "wrong-secret-at-least-16";
    assert.equal((await provisionVersion(record)).status, "failed");
    process.env.CONTRACT_RECEIVER_WS_URL = "ws://example.com/ws";
    assert.equal((await provisionVersion(record)).status, "failed");
    delete process.env.CONTRACT_RECEIVER_WS_URL;
    delete process.env.CONTRACT_RECEIVER_TOKEN;
    assert.equal((await provisionVersion(record)).status, "not_configured");
    console.log("Backend receiver checks passed.");
  } finally {
    child.kill();
    await once(child, "exit");
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
