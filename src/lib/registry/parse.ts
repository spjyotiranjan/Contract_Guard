import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { RegistryError } from "./errors";
import type { JsonObject, JsonValue, OpenApiDefinition, ServiceDefinition } from "./types";

const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"]);
const MAX_FILE_SIZE = 1024 * 1024;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Restrict inputs to JSON data; MongoDB must not receive special YAML values.
function checkJson(value: unknown, depth = 0): asserts value is JsonValue {
  if (depth > 100) throw new RegistryError(400, "YAML nesting is too deep.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) checkJson(item, depth + 1);
    return;
  }
  if (object(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    for (const [key, item] of Object.entries(value)) {
      if (key.includes("\0")) throw new RegistryError(400, "YAML keys cannot contain null characters.");
      checkJson(item, depth + 1);
    }
    return;
  }
  throw new RegistryError(400, "YAML must contain only JSON-compatible values.");
}

export async function parseYaml(file: File): Promise<{ definition: JsonObject; sourceHash: string; sourceFile: string }> {
  if (file.size === 0 || file.size > MAX_FILE_SIZE) throw new RegistryError(400, "YAML file must be between 1 byte and 1 MiB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new RegistryError(400, "YAML must be UTF-8 encoded."); }
  try {
    const doc = parseDocument(text, { uniqueKeys: true, strict: true });
    if (doc.errors.length || doc.warnings.length) throw new Error("Invalid YAML");
    const definition: unknown = doc.toJS({ maxAliasCount: 100 });
    checkJson(definition);
    if (!object(definition)) throw new RegistryError(400, "YAML root must be an object.");
    return { definition: definition as JsonObject, sourceHash: createHash("sha256").update(bytes).digest("hex"), sourceFile: file.name.slice(0, 255) || "upload.yaml" };
  } catch (error) {
    if (error instanceof RegistryError) throw error;
    throw new RegistryError(400, "Invalid YAML document.");
  }
}

export function validateApi(definition: JsonObject, suppliedVersion?: string): OpenApiDefinition {
  if (!nonEmpty(definition.openapi) || !/^3\.\d+\.\d+(?:[-+].*)?$/.test(definition.openapi) || !object(definition.info) || !nonEmpty(definition.info.title)) {
    throw new RegistryError(400, "OpenAPI 3 document must include openapi and info.title.");
  }
  const declaredVersion = definition.info.version;
  if (declaredVersion !== undefined && (!nonEmpty(declaredVersion) || declaredVersion.length > 200 || declaredVersion !== declaredVersion.trim())) {
    throw new RegistryError(400, "YAML info.version must be a non-empty string of at most 200 characters without surrounding whitespace.");
  }
  if (declaredVersion && suppliedVersion && declaredVersion !== suppliedVersion) throw new RegistryError(400, "Provided version must match the YAML info.version.");
  const version = declaredVersion || suppliedVersion;
  if (!version) throw new RegistryError(400, "API version is required when YAML info.version is missing.");
  definition.info.version = version;
  if (definition.paths !== undefined && !object(definition.paths)) throw new RegistryError(400, "OpenAPI paths must be an object.");
  return definition as OpenApiDefinition;
}

export function validateService(definition: JsonObject, name: string): ServiceDefinition {
  if (!nonEmpty(definition.consumer) || !nonEmpty(definition.team) || !Array.isArray(definition.uses)) {
    throw new RegistryError(400, "Service YAML must contain consumer, team, and a uses array.");
  }
  if (definition.consumer !== name) throw new RegistryError(400, "YAML consumer must match the service name.");
  for (const use of definition.uses) {
    if (!object(use) || !nonEmpty(use.provider) || !nonEmpty(use.method) || !methods.has(use.method.toUpperCase()) || !nonEmpty(use.path) || !use.path.startsWith("/") || !Array.isArray(use.sends) || !use.sends.every(nonEmpty) || !Array.isArray(use.reads) || !use.reads.every(nonEmpty)) {
      throw new RegistryError(400, "Each use must contain a provider, valid HTTP method, path, sends array, and reads array.");
    }
    use.method = use.method.toUpperCase();
  }
  return definition as ServiceDefinition;
}
