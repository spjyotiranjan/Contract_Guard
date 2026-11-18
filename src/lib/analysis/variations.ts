import type { JsonObject, JsonValue, ServiceUse } from "../registry/types";
import type { AnalysisStatus, VariationAnalysis, VariationCheck } from "./types";

// This deliberately small dialect fails closed on unsupported constraints.
const LIMIT = 512;
const MAX_DEPTH = 12;
const MAX_PROPERTIES = 16;
const MAX_ARRAY = 5;
type Obj = Record<string, JsonValue>;
type Domain = { values: JsonValue[]; exhaustive: boolean };
type Schema = {
  type: string; nullable: boolean; enum?: JsonValue[]; minimum?: number; maximum?: number;
  properties?: Record<string, Schema>; required?: string[]; additional?: boolean;
  items?: Schema; minItems?: number; maxItems?: number;
};
const object = (value: JsonValue | undefined): value is Obj => value !== null && typeof value === "object" && !Array.isArray(value);
const reason = (message: string): never => { throw new Error(message); };

function schema(value: JsonValue | undefined, root: JsonObject, dialect: "3.0" | "3.1" | "consumer", seen = new Set<string>(), depth = 0): Schema {
  if (depth > MAX_DEPTH || !object(value)) return reason("Schema is missing, recursive, or too deep.");
  if (value.$ref !== undefined) {
    if (typeof value.$ref !== "string" || !value.$ref.startsWith("#/") || seen.has(value.$ref) || Object.keys(value).some((key) => !["$ref", "description", "summary"].includes(key))) return reason("Reference is external, cyclic, or has unsupported sibling constraints.");
    let current: JsonValue = root;
    for (const part of value.$ref.slice(2).split("/")) {
      if (!object(current) || !Object.hasOwn(current, part.replaceAll("~1", "/").replaceAll("~0", "~"))) return reason("Reference cannot be resolved.");
      current = current[part.replaceAll("~1", "/").replaceAll("~0", "~")];
    }
    const next = new Set(seen); next.add(value.$ref);
    return schema(current, root, dialect, next, depth + 1);
  }
  const allowed = new Set(["type", "nullable", "enum", "minimum", "maximum", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "title", "description", "example", "examples", "deprecated", "default"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return reason("Schema contains unsupported constraints or composition.");
  if (value.nullable !== undefined && (dialect === "3.1" || typeof value.nullable !== "boolean")) return reason("Unsupported nullable declaration.");
  let type: string;
  let nullable = value.nullable === true;
  if (Array.isArray(value.type)) {
    if (dialect !== "3.1" || value.type.length !== 2 || !value.type.includes("null") || value.type.filter((v) => v !== "null").length !== 1 || typeof value.type.find((v) => v !== "null") !== "string") return reason("Unsupported union type.");
    type = value.type.find((v) => v !== "null") as string; nullable = true;
  } else if (typeof value.type === "string") type = value.type;
  else return reason("Schema type is missing or unsupported.");
  if (!["object", "array", "string", "integer", "number", "boolean", "null"].includes(type)) return reason("Unsupported schema type.");
  if (type !== "object" && (value.properties !== undefined || value.required !== undefined || value.additionalProperties !== undefined)) return reason("Object constraints require an object type.");
  if (type !== "array" && (value.items !== undefined || value.minItems !== undefined || value.maxItems !== undefined)) return reason("Array constraints require an array type.");
  if (value.enum !== undefined && (!Array.isArray(value.enum) || !value.enum.length || value.enum.length > LIMIT || value.enum.some((v) => v !== null && typeof v === "object"))) return reason("Only bounded non-empty scalar enums are supported.");
  if (value.enum !== undefined && ["object", "array"].includes(type)) return reason("Object and array enums are unsupported.");
  if ((value.minimum !== undefined || value.maximum !== undefined) && !["integer", "number"].includes(type)) return reason("Numeric constraints require a numeric type.");
  if ((value.minimum !== undefined && typeof value.minimum !== "number") || (value.maximum !== undefined && typeof value.maximum !== "number")) return reason("Invalid numeric bound.");
  const result: Schema = { type, nullable, ...(Array.isArray(value.enum) ? { enum: value.enum } : {}), ...(typeof value.minimum === "number" ? { minimum: value.minimum } : {}), ...(typeof value.maximum === "number" ? { maximum: value.maximum } : {}) };
  if (type === "object") {
    if (value.properties !== undefined && !object(value.properties)) return reason("Invalid properties.");
    if (value.required !== undefined && (!Array.isArray(value.required) || !value.required.every((v) => typeof v === "string") || new Set(value.required).size !== value.required.length)) return reason("Invalid required fields.");
    if (value.additionalProperties !== undefined && typeof value.additionalProperties !== "boolean") return reason("Schema-valued additionalProperties is not supported.");
    const props = object(value.properties) ? value.properties : {};
    if (Object.keys(props).length > MAX_PROPERTIES) return reason("Object has too many properties to analyze.");
    result.properties = Object.fromEntries(Object.entries(props).map(([key, child]) => [key, schema(child, root, dialect, seen, depth + 1)]));
    result.required = (value.required as string[] | undefined) ?? [];
    if (result.required.some((key) => !Object.hasOwn(props, key))) return reason("Required field has no declared schema.");
    result.additional = value.additionalProperties !== false;
  } else if (type === "array") {
    if (value.items === undefined) return reason("Array items schema is missing.");
    if ((value.minItems !== undefined && (!Number.isSafeInteger(value.minItems) || Number(value.minItems) < 0)) || (value.maxItems !== undefined && (!Number.isSafeInteger(value.maxItems) || Number(value.maxItems) < 0))) return reason("Invalid array bounds.");
    result.items = schema(value.items, root, dialect, seen, depth + 1);
    result.minItems = typeof value.minItems === "number" ? value.minItems : 0;
    result.maxItems = typeof value.maxItems === "number" ? value.maxItems : undefined;
  } else if (value.properties !== undefined || value.required !== undefined || value.additionalProperties !== undefined || value.items !== undefined || value.minItems !== undefined || value.maxItems !== undefined) return reason("Schema keywords do not match the type.");
  return result;
}

function valid(value: JsonValue, s: Schema): boolean {
  if (s.enum && !s.enum.some((v) => Object.is(v, value))) return false;
  if (value === null) return s.type === "null" || s.nullable;
  if (s.type === "null") return false;
  if (s.type === "object") {
    if (!object(value)) return false;
    if (s.required?.some((key) => !Object.hasOwn(value, key))) return false;
    return Object.entries(value).every(([key, child]) => s.properties && Object.hasOwn(s.properties, key) ? valid(child, s.properties[key]) : s.additional === true);
  }
  if (s.type === "array") return Array.isArray(value) && value.length >= (s.minItems ?? 0) && (s.maxItems === undefined || value.length <= s.maxItems) && value.every((item) => valid(item, s.items!));
  if (s.type === "integer" || s.type === "number") return typeof value === "number" && Number.isFinite(value) && (s.type !== "integer" || Number.isInteger(value)) && (s.minimum === undefined || value >= s.minimum) && (s.maximum === undefined || value <= s.maximum);
  return typeof value === s.type;
}

function domain(s: Schema): Domain {
  let values: JsonValue[] = [];
  let exhaustive = true;
  if (s.enum) values = s.enum.filter((v) => valid(v, s));
  else if (s.type === "null") values = [null];
  else if (s.type === "boolean") values = [false, true];
  else if (s.type === "string") { values = ["", "example"]; exhaustive = false; }
  else if (s.type === "integer" && s.minimum !== undefined && s.maximum !== undefined && Number.isSafeInteger(Math.ceil(s.minimum)) && Number.isSafeInteger(Math.floor(s.maximum)) && Math.floor(s.maximum) - Math.ceil(s.minimum) < LIMIT) {
    for (let i = Math.ceil(s.minimum); i <= Math.floor(s.maximum); i++) values.push(i);
  } else if (s.type === "number" || s.type === "integer") {
    const min = s.minimum ?? 0; const max = s.maximum ?? min + 1;
    values = [min, max, 0, 1, -1].map((v) => s.type === "integer" ? Math.ceil(v) : v).filter((v) => valid(v, s)); exhaustive = false;
  } else if (s.type === "object") {
    let combinations: JsonObject[] = [{}];
    for (const [key, child] of Object.entries(s.properties ?? {})) {
      const item = domain(child); const required = s.required?.includes(key);
      if (!item.exhaustive) exhaustive = false;
      const next: JsonObject[] = [];
      for (const current of combinations) {
        if (!required) next.push(current);
        for (const value of item.values) {
          if (next.length >= LIMIT) { exhaustive = false; break; }
          next.push({ ...current, [key]: value });
        }
        if (next.length >= LIMIT) { exhaustive = false; break; }
      }
      combinations = next;
    }
    values = combinations;
    if (s.additional) { exhaustive = false; const key = Object.hasOwn(s.properties ?? {}, "__extra__") ? "__other__" : "__extra__"; if (!Object.hasOwn(s.properties ?? {}, key) && combinations.length && values.length < LIMIT) values = [...values, { ...combinations[0], [key]: true }]; }
  } else if (s.type === "array") {
    const item = domain(s.items!); const min = s.minItems ?? 0;
    if (min > MAX_ARRAY) return { values: [], exhaustive: false };
    const max = Math.min(s.maxItems ?? MAX_ARRAY, MAX_ARRAY);
    if (s.maxItems === undefined || s.maxItems > MAX_ARRAY || !item.exhaustive) exhaustive = false;
    let current: JsonValue[][] = [[]];
    for (let n = 0; n <= max; n++) {
      if (n >= min) values.push(...current);
      if (values.length >= LIMIT) { values = values.slice(0, LIMIT); exhaustive = false; break; }
      const next: JsonValue[][] = [];
      for (const array of current) {
        for (const v of item.values) { if (next.length >= LIMIT) { exhaustive = false; break; } next.push([...array, v]); }
        if (next.length >= LIMIT) break;
      }
      current = next;
    }
  }
  if (s.nullable && valid(null, s) && !values.includes(null)) { if (values.length >= LIMIT) exhaustive = false; else values.push(null); }
  return { values: values.filter((value) => valid(value, s)), exhaustive };
}

function resolve(value: JsonValue | undefined, root: JsonObject, seen = new Set<string>()): Obj | undefined {
  if (!object(value)) return;
  if (value.$ref === undefined) return value;
  if (typeof value.$ref !== "string" || !value.$ref.startsWith("#/") || seen.has(value.$ref) || seen.size >= MAX_DEPTH || Object.keys(value).some((key) => !["$ref", "summary", "description"].includes(key))) return;
  let current: JsonValue = root;
  for (const part of value.$ref.slice(2).split("/")) { const key = part.replaceAll("~1", "/").replaceAll("~0", "~"); if (!object(current) || !Object.hasOwn(current, key)) return; current = current[key]; }
  const next = new Set(seen); next.add(value.$ref); return resolve(current, root, next);
}

function compare(source: JsonValue | undefined, sourceRoot: JsonObject, sourceDialect: "3.0" | "3.1" | "consumer", target: JsonValue | undefined, targetRoot: JsonObject, targetDialect: "3.0" | "3.1" | "consumer"): Pick<VariationCheck, "status" | "coverage" | "checked" | "message" | "example"> {
  try {
    const a = schema(source, sourceRoot, sourceDialect); const b = schema(target, targetRoot, targetDialect);
    const generated = domain(a);
    const rejected = generated.values.findIndex((value) => !valid(value, b));
    if (rejected !== -1) return { status: "incompatible", coverage: generated.exhaustive ? "exhaustive" : "sampled", checked: rejected + 1, message: "A permitted source body is rejected by the target schema.", example: generated.values[rejected] };
    if (!generated.values.length) return { status: "unknown", coverage: "unavailable", checked: 0, message: "No valid bodies could be generated; the schema may be empty or exceed limits." };
    if (!generated.exhaustive) return { status: "unknown", coverage: "sampled", checked: generated.values.length, message: "Sampled bodies passed, but not all possible bodies were covered." };
    return { status: "match", coverage: "exhaustive", checked: generated.values.length, message: "Every generated body in the supported finite domain was accepted." };
  } catch (error) { return { status: "unknown", coverage: "unavailable", checked: 0, message: error instanceof Error ? error.message : "Schema cannot be evaluated." }; }
}

type FieldNode = { array: boolean; children: Map<string, FieldNode> };
function fieldTree(fields: string[]): FieldNode {
  const root: FieldNode = { array: false, children: new Map() };
  for (const field of fields) {
    let node = root;
    for (const part of field.split(".")) {
      if (!/^[^.[\]]+(?:\[\])?$/.test(part)) return reason(`Cannot interpret field path ${field}.`);
      const array = part.endsWith("[]"); const name = array ? part.slice(0, -2) : part;
      const existing = node.children.get(name);
      if (existing && existing.array !== array) return reason(`Ambiguous field path ${field}.`);
      if (!existing) node.children.set(name, { array, children: new Map() });
      node = node.children.get(name)!;
    }
  }
  return root;
}

// Checks presence only; no values, types, or actual consumer behavior are inferred.
function presenceProblems(node: FieldNode, s: Schema, prefix = ""): string[] {
  if (s.type !== "object") return [`Cannot interpret properties at ${prefix || "body"}.`];
  const problems: string[] = [];
  for (const required of s.required ?? []) if (!node.children.has(required)) problems.push(`API requires ${prefix}${required}.`);
  for (const [key, child] of node.children) {
    if (!s.properties || !Object.hasOwn(s.properties, key)) {
      if (!s.additional) problems.push(`API does not declare ${prefix}${key} and disallows extra fields.`);
      continue;
    }
    let field = s.properties[key];
    if (child.array) {
      if (field.type !== "array" || !field.items) { problems.push(`API does not declare ${prefix}${key} as an array.`); continue; }
      field = field.items;
    }
    if (child.children.size) problems.push(...presenceProblems(child, field, `${prefix}${key}${child.array ? "[]" : ""}.`));
  }
  return problems;
}

function responseFieldGuaranteed(s: Schema, path: string): boolean | undefined {
  let current = s;
  for (const part of path.split(".")) {
    if (!/^[^.[\]]+(?:\[\])?$/.test(part) || current.type !== "object") return undefined;
    const array = part.endsWith("[]"); const key = array ? part.slice(0, -2) : part;
    if (!current.properties || !Object.hasOwn(current.properties, key)) return undefined;
    if (!current.required?.includes(key) || current.nullable) return false;
    current = current.properties[key];
    if (array) {
      if (current.type !== "array" || !current.items) return undefined;
      current = current.items;
    }
  }
  return true;
}

function fieldVariations(use: ServiceUse, api: JsonObject, pathItem: Obj, op: Obj, dialect: "3.0" | "3.1", direction: "request" | "response"): Pick<VariationCheck, "status" | "coverage" | "checked" | "message" | "example"> {
  const fields = [...new Set(direction === "request" ? use.sends : use.reads)];
  if (fields.length > 32) return { status: "unknown", coverage: "unavailable", checked: 0, message: "Too many fields to generate bounded presence variations." };
  try {
    fieldTree(fields);
    const total = 2 ** fields.length;
    const count = Math.min(total, LIMIT);
    let risky = 0; let first: { present: string[]; omitted: string[]; reason: string } | undefined;
    if (direction === "request") {
      const params = new Map<string, Obj>();
      for (const list of [pathItem.parameters, op.parameters]) {
        if (list === undefined) continue;
        if (!Array.isArray(list)) return reason("API parameters are invalid.");
        for (const item of list) {
          const p = resolve(item, api);
          if (!p || typeof p.name !== "string" || typeof p.in !== "string") return reason("API parameter cannot be resolved.");
          params.set(`${p.in}:${p.name}`, p);
        }
      }
      const paramNames = new Set([...params.values()].map((p) => String(p.name)));
      for (const match of use.path.matchAll(/\{([^}]+)\}/g)) paramNames.add(match[1]);
      const rawBody = op.requestBody; const body = rawBody === undefined ? undefined : resolve(rawBody, api);
      if (rawBody !== undefined && !body) return reason("API request body cannot be resolved.");
      const content = body && object(body.content) ? body.content : undefined;
      const media = content && object(content["application/json"]) ? content["application/json"] : undefined;
      const bodySchema = media ? schema(media.schema, api, dialect) : undefined;
      if (body && !bodySchema) return reason("API JSON request body schema is unavailable.");
      for (let mask = 0; mask < count; mask++) {
        const present = fields.filter((_, i) => Math.floor(mask / 2 ** i) % 2 === 1);
        const omitted = fields.filter((_, i) => Math.floor(mask / 2 ** i) % 2 === 0);
        const problems: string[] = [];
        for (const p of params.values()) if ((p.required === true || p.in === "path") && !present.includes(String(p.name))) problems.push(`API requires ${String(p.in)} parameter ${String(p.name)}.`);
        for (const match of use.path.matchAll(/\{([^}]+)\}/g)) if (!present.includes(match[1])) problems.push(`Path requires ${match[1]}.`);
        const bodyFields = present.filter((field) => !paramNames.has(field));
        if (body?.required === true && !bodyFields.length) problems.push("API requires a request body; body presence is not specified by sends.");
        if (bodySchema) problems.push(...presenceProblems(fieldTree(bodyFields), bodySchema));
        else if (bodyFields.length) problems.push("API does not declare a request body; acceptance is unspecified.");
        if (problems.length) { risky++; first ??= { present, omitted, reason: problems[0] }; }
      }
    } else {
      const responses = object(op.responses) ? op.responses : undefined;
      if (!responses) return reason("API responses are unavailable.");
      const successes = Object.entries(responses).filter(([status]) => /^2\d\d$/.test(status));
      if (!successes.length || Object.keys(responses).some((status) => /^2XX$/i.test(status) || status === "default")) return reason("Successful responses are missing or use wildcard statuses.");
      const uncertain = new Set<string>();
      for (const [status, raw] of successes) {
        const response = resolve(raw, api); const content = response && object(response.content) ? response.content : undefined;
        const json = content && object(content["application/json"]) ? content["application/json"] : undefined;
        if (!json) return reason(`API response ${status} JSON schema is unavailable.`);
        const responseSchema = schema(json.schema, api, dialect);
        for (const field of fields) if (responseFieldGuaranteed(responseSchema, field) !== true) uncertain.add(field);
      }
      for (let mask = 0; mask < count; mask++) {
        const present = fields.filter((_, i) => Math.floor(mask / 2 ** i) % 2 === 1);
        const omitted = fields.filter((_, i) => Math.floor(mask / 2 ** i) % 2 === 0);
        const possible = omitted.filter((field) => uncertain.has(field));
        if (possible.length) { risky++; first ??= { present, omitted, reason: `API does not guarantee ${possible.join(", ")} in every successful response.` }; }
      }
    }
    return { status: "unknown", coverage: count === total ? "exhaustive" : "sampled", checked: count,
      message: `${risky} of ${count} hypothetical ${direction} field-presence combinations raise a potential concern. Fields are independently present or omitted by assumption; types, values, correlations and actual behavior are unverified.`, ...(first ? { example: first } : {}) };
  } catch (error) { return { status: "unknown", coverage: "unavailable", checked: 0, message: error instanceof Error ? error.message : "Field-presence analysis unavailable." }; }
}

const aggregate = (checks: VariationCheck[]): AnalysisStatus => checks.some((c) => c.status === "incompatible") ? "incompatible" : checks.length && checks.every((c) => c.status === "match") ? "match" : "unknown";

/** Contract variation results are independent of existing structural matching. */
export function analyzeVariations(api: JsonObject, uses: ServiceUse[]): VariationAnalysis {
  const checks: VariationCheck[] = [];
  const dialect = typeof api.openapi === "string" && api.openapi.startsWith("3.0.") ? "3.0" : typeof api.openapi === "string" && api.openapi.startsWith("3.1.") ? "3.1" : undefined;
  for (const use of uses) {
    const add = (direction: "request" | "response", result: Pick<VariationCheck, "status" | "coverage" | "checked" | "message" | "example">, responseStatus?: string) => checks.push({ method: use.method, path: use.path, direction, ...(responseStatus ? { responseStatus } : {}), ...result });
    const warning = (message: string) => ({ status: "unknown" as const, coverage: "unavailable" as const, checked: 0, message });
    if (checks.length >= 2048) { add("request", warning("Analysis limit reached; remaining operations were not checked.")); break; }
    const contract = object(use.contract) ? use.contract : undefined;
    const paths = object(api.paths) ? api.paths : undefined;
    const pathItem = paths ? resolve(paths[use.path], api) : undefined;
    const op = pathItem ? resolve(pathItem[use.method.toLowerCase()], api) : undefined;
    if (!dialect || !op || !pathItem) { const message = !dialect ? "OpenAPI version is not supported." : "Operation is missing or cannot be resolved."; add("request", warning(message)); add("response", warning(message)); continue; }
    if (!contract) { add("request", fieldVariations(use, api, pathItem, op, dialect, "request")); add("response", fieldVariations(use, api, pathItem, op, dialect, "response")); continue; }
    if (contract.version !== 1) { add("request", warning("Unsupported service contract version.")); add("response", warning("Unsupported service contract version.")); continue; }
    const request = object(contract.request) ? contract.request : undefined;
    if (!request) add("request", fieldVariations(use, api, pathItem, op, dialect, "request"));
    else if (!["required", "optional", "none"].includes(String(request.body))) add("request", warning("Service request body contract is invalid."));
    else {
      const rawBody = op.requestBody;
      const body = rawBody === undefined ? undefined : resolve(rawBody, api);
      if (rawBody !== undefined && !body) add("request", warning("API request body cannot be resolved."));
      else if ((request.body === "optional" || request.body === "none") && body?.required === true) add("request", { status: "incompatible", coverage: "exhaustive", checked: 1, message: "Service may omit a body that the API requires.", example: "<body omitted>" });
      else if (request.body === "none") add("request", { status: "match", coverage: "exhaustive", checked: 1, message: "The declared request has no body, and the API does not require one." });
      else if (!body) add("request", warning("API does not declare a request body; acceptance is unspecified."));
      else {
        const content = object(body.content) ? body.content : undefined;
        const json = content && object(content["application/json"]) ? content["application/json"] : undefined;
        if (!json || !object(json.schema)) add("request", warning("API JSON request schema is unavailable."));
        else {
          const result = compare(request.schema, contract as JsonObject, "consumer", json.schema, api, dialect);
          if (request.body === "optional" && result.coverage !== "unavailable") result.checked++;
          add("request", result);
        }
      }
    }
    const responseContracts = object(contract.responses) ? contract.responses : undefined;
    const responses = object(op.responses) ? op.responses : undefined;
    if (!responseContracts) { add("response", fieldVariations(use, api, pathItem, op, dialect, "response")); continue; }
    if (!responses) { add("response", warning("API responses are missing.")); continue; }
    if (Object.keys(responses).some((status) => !/^\d{3}$/.test(status))) add("response", warning("Wildcard or default response statuses cannot be exhaustively checked."));
    const statuses = Object.keys(responses).filter((status) => /^\d{3}$/.test(status));
    if (!statuses.length) add("response", warning("No explicit API response statuses are declared."));
    if (statuses.length > 100) { add("response", warning("Too many response statuses to analyze.")); continue; }
    for (const status of statuses) {
      const response = resolve(responses[status], api);
      const accepted = object(responseContracts[status]) ? responseContracts[status] : undefined;
      if (!response) { add("response", warning(`API response ${status} cannot be resolved.`), status); continue; }
      if (!accepted) { add("response", warning(`Service handling of response ${status} is not declared.`), status); continue; }
      if (!["required", "optional", "none"].includes(String(accepted.body))) { add("response", warning(`Service response ${status} body policy is invalid.`), status); continue; }
      const content = object(response.content) ? response.content : undefined;
      if (!content || !Object.keys(content).length) { add("response", warning(`API response ${status} has no declared content; body behavior is unverified.`), status); continue; }
      if (Object.keys(content).some((key) => key !== "application/json") || !object(content["application/json"])) { add("response", warning(`API response ${status} has unsupported media types.`), status); continue; }
      if (accepted.body === "none") { add("response", warning(`API response ${status} declares a body, but the service accepts none.`), status); continue; }
      if (accepted.body === "required") add("response", warning(`API response ${status} does not guarantee body presence.`), status);
      add("response", compare(content["application/json"].schema, api, dialect, accepted.schema, contract as JsonObject, "consumer"), status);
    }
  }
  return { status: aggregate(checks), checks };
}
