import http from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { WebSocketServer } from "ws";
import { parseDocument } from "yaml";

const PORT = Number(process.env.PORT || 9100);
const HOST = process.env.HOST || "127.0.0.1";
const token = process.env.RECEIVER_TOKEN;
const DATA_DIR = process.env.DATA_DIR || "./data";
const MAX_BYTES = 2 * 1024 * 1024;
const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const ID = /^[a-f0-9]{24}$/;
if (!token || token.length < 16) throw new Error("RECEIVER_TOKEN must contain at least 16 characters.");

function validToken(value) {
  const a = Buffer.from(value || ""); const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
function fail(message) { throw new Error(message); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function routePattern(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("?") || path.includes("#") || path.includes("\\") || path.includes("%")) fail("Invalid OpenAPI path.");
  const segments = path.split("/").slice(1);
  if (segments.some((s) => s === "." || s === "..")) fail("Invalid OpenAPI path segment.");
  const matchers = segments.map((segment) => {
    if (/^\{[^{}\/]+\}$/.test(segment)) return null;
    if (/[{}]/.test(segment)) fail("Only whole-segment path parameters are supported.");
    return segment;
  });
  return { matchers, shape: JSON.stringify(matchers), specificity: matchers.filter((part) => part !== null).length };
}
function buildContract(message) {
  const { apiId, versionId, yaml } = message;
  if (typeof apiId !== "string" || typeof versionId !== "string" || !ID.test(apiId) || !ID.test(versionId)) fail("apiId and versionId must be lowercase ObjectIds.");
  if (typeof yaml !== "string" || Buffer.byteLength(yaml) > 1024 * 1024) fail("YAML must be at most 1 MiB.");
  const doc = parseDocument(yaml, { uniqueKeys: true, strict: true });
  if (doc.errors.length || doc.warnings.length) fail("Invalid YAML.");
  const definition = doc.toJS({ maxAliasCount: 100 });
  if (!isObject(definition) || typeof definition.openapi !== "string" || !definition.openapi.startsWith("3.") || !isObject(definition.info) || typeof definition.info.version !== "string" || !definition.info.version.trim()) fail("OpenAPI 3 info.version is required.");
  if (definition.paths !== undefined && !isObject(definition.paths)) fail("OpenAPI paths must be an object.");
  const operations = []; const shapes = new Set();
  for (const [path, item] of Object.entries(definition.paths || {})) {
    if (!isObject(item) || item.$ref) fail(`Path ${path} must be an inline path item.`);
    const route = routePattern(path);
    for (const [method, operation] of Object.entries(item)) {
      if (!METHODS.has(method)) continue;
      if (!isObject(operation)) fail(`Invalid ${method.toUpperCase()} operation at ${path}.`);
      const key = method + route.shape;
      if (shapes.has(key)) fail(`Ambiguous ${method.toUpperCase()} path ${path}.`);
      shapes.add(key);
      operations.push({ method: method.toUpperCase(), path, ...route, operation, parameters: item.parameters || [] });
    }
  }
  operations.sort((a, b) => b.specificity - a.specificity || a.path.localeCompare(b.path));
  return { apiId, versionId, version: definition.info.version, definition, operations };
}
await mkdir(DATA_DIR, { recursive: true });
const stateFile = join(DATA_DIR, "contracts.json");
let contracts = new Map();
try {
  const saved = JSON.parse(await readFile(stateFile, "utf8"));
  if (!Array.isArray(saved)) fail("Invalid saved contracts.");
  contracts = new Map(saved.map((message) => { const contract = buildContract(message); return [contract.versionId, contract]; }));
} catch (error) { if (error.code !== "ENOENT") throw error; }
let writes = Promise.resolve();
function provision(message) {
  const result = writes.then(async () => {
    const contract = buildContract(message);
    const old = contracts.get(contract.versionId);
    if (old && (old.apiId !== contract.apiId || !isDeepStrictEqual(old.definition, contract.definition))) fail("Version ID already belongs to a different contract.");
    if (!old) {
      const next = new Map(contracts); next.set(contract.versionId, contract);
      const saved = [...next.values()].map((item) => ({ apiId: item.apiId, versionId: item.versionId, yaml: JSON.stringify(item.definition) }));
      const temp = `${stateFile}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(saved), { mode: 0o600 });
      await rename(temp, stateFile);
      contracts = next;
    }
    return { apiId: contract.apiId, versionId: contract.versionId, version: contract.version, basePath: `/mock/${contract.apiId}/${contract.versionId}`, endpoints: contract.operations.map(({ method, path }) => ({ method, path })) };
  });
  writes = result.catch(() => {});
  return result;
}
function send(res, status, value, head = false) {
  const body = JSON.stringify(value); res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), "cache-control": "no-store", "x-contract-guard-simulated": "true" });
  res.end(head ? undefined : body);
}
const server = http.createServer((req, res) => {
  req.on("error", () => {});
  if (!validToken(req.headers.authorization)) return send(res, 401, { error: "Unauthorized" });
  const path = (req.url || "").split("?", 1)[0];
  const parts = path.split("/");
  if (parts[1] === "contracts" && parts.length === 4 && req.method === "GET") {
    const contract = contracts.get(parts[3]);
    if (!contract || contract.apiId !== parts[2]) return send(res, 404, { error: "Contract not found" });
    return send(res, 200, { apiId: contract.apiId, versionId: contract.versionId, version: contract.version, definition: contract.definition, endpoints: contract.operations.map(({ method, path, operation, parameters }) => ({ method, path, operation, pathParameters: parameters })) });
  }
  if (parts[1] !== "mock" || parts.length < 5 || !ID.test(parts[2]) || !ID.test(parts[3])) return send(res, 404, { error: "Not found" });
  const contract = contracts.get(parts[3]);
  if (!contract || contract.apiId !== parts[2]) return send(res, 404, { error: "Contract not found" });
  let segments;
  try { segments = parts.slice(4).map(decodeURIComponent); } catch { return send(res, 400, { error: "Invalid path encoding" }); }
  if (segments.some((segment) => segment.includes("/"))) return send(res, 400, { error: "Invalid path segment" });
  const candidates = contract.operations.filter((op) => op.matchers.length === segments.length && op.matchers.every((part, i) => part === null ? segments[i].length > 0 : part === segments[i]));
  const operation = candidates.find((op) => op.method === req.method);
  if (!operation) return send(res, candidates.length ? 405 : 404, { error: candidates.length ? "Method not offered" : "Endpoint not found" });
  req.resume();
  return send(res, 200, { simulated: true, apiId: contract.apiId, versionId: contract.versionId, version: contract.version, method: operation.method, path: operation.path, operationId: operation.operation.operationId ?? null }, req.method === "HEAD");
});
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES });
server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/ws" || !validToken(req.headers.authorization)) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});
wss.on("connection", (ws) => {
  ws.on("error", () => {});
  ws.on("message", async (raw, binary) => {
    let requestId;
    try {
      if (binary) fail("Expected a JSON text message.");
      const message = JSON.parse(raw.toString());
      if (!isObject(message) || message.type !== "provision" || typeof message.requestId !== "string" || message.requestId.length > 100) fail("Invalid request.");
      requestId = message.requestId;
      const data = await provision(message);
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ requestId, ok: true, data }));
    } catch (error) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ requestId, ok: false, error: error instanceof Error ? error.message : "Provisioning failed." }));
    }
  });
});
server.listen(PORT, HOST, () => console.log(`Contract receiver listening on ${HOST}:${PORT}`));
