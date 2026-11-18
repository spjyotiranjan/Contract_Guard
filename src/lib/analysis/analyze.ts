import type { JsonObject, JsonValue, ServiceUse } from "../registry/types";
import type { AnalysisIssue, AnalysisStatus } from "./types";

type Obj = Record<string, JsonValue>;
type Result = { status: AnalysisStatus; issues: AnalysisIssue[] };
const isObj = (v: JsonValue | undefined): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Conservative, structural checks against one OpenAPI revision. */
export function analyzeUses(definition: JsonObject, uses: ServiceUse[]): Result {
  const issues: AnalysisIssue[] = [];
  function add(use: ServiceUse, status: "unknown" | "incompatible", code: string, message: string, field?: string) {
    issues.push({ status, code, message, method: use.method, path: use.path, ...(field ? { field } : {}) });
  }
  function resolve(value: JsonValue | undefined, seen = new Set<string>()): Obj | undefined {
    if (!isObj(value)) return;
    if (typeof value.$ref !== "string") return value;
    const ref = value.$ref;
    if (!ref.startsWith("#/" ) || seen.has(ref) || seen.size >= 50) return;
    let current: JsonValue = definition;
    for (const part of ref.slice(2).split("/")) {
      if (!isObj(current)) return;
      const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
      if (!Object.hasOwn(current, key)) return;
      current = current[key];
    }
    const next = new Set(seen); next.add(ref);
    return resolve(current, next);
  }
  function supportedSchema(value: JsonValue | undefined, use: ServiceUse): Obj | undefined {
    const schema = resolve(value);
    if (!schema || schema.allOf !== undefined || schema.anyOf !== undefined || schema.oneOf !== undefined || schema.not !== undefined || schema.$dynamicRef !== undefined) {
      add(use, "unknown", "unsupported_schema", "Schema is missing, unresolved, cyclic, or uses unsupported composition.");
      return;
    }
    if (schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes("null"))) add(use, "unknown", "nullable_schema", "Nullable schema values cannot be verified from consumer YAML.");
    return schema;
  }
  function checkField(schemaValue: JsonValue | undefined, field: string, use: ServiceUse, response: boolean): void {
    const parts = field.split(".");
    if (parts.some((part) => !/^[^.[\]]+(?:\[\])?$/.test(part))) { add(use, "unknown", "field_syntax", `Cannot interpret field path ${field}.`, field); return; }
    let current = schemaValue;
    for (const part of parts) {
      const array = part.endsWith("[]"); const name = array ? part.slice(0, -2) : part;
      const schema = supportedSchema(current, use); if (!schema) return;
      if (schema.type !== undefined && schema.type !== "object") { add(use, "unknown", "schema_type", `Cannot interpret object properties for ${field}.`, field); return; }
      const props = schema.properties;
      if (!isObj(props)) { add(use, "unknown", "properties_unknown", `Cannot determine properties for ${field}.`, field); return; }
      if (!Object.hasOwn(props, name)) {
        if (!response && schema.additionalProperties !== false) add(use, "unknown", "additional_properties", `Field ${field} is not declared; additional properties may be accepted.`, field);
        else add(use, "incompatible", "field_missing", `Field ${field} is not declared in the ${response ? "response" : "request"} schema.`, field);
        return;
      }
      if (response && (!Array.isArray(schema.required) || !schema.required.includes(name))) add(use, "unknown", "response_optional", `Response field ${field} is not guaranteed by the schema.`, field);
      current = props[name];
      if (array) {
        const child = supportedSchema(current, use); if (!child) return;
        if (child.type !== "array") { add(use, "incompatible", "not_array", `Field ${field} expects an array.`, field); return; }
        current = child.items;
      }
    }
    const terminal = supportedSchema(current, use);
    if (terminal?.type === "array") add(use, "unknown", "array_path_ambiguous", `Field ${field} refers to an array without an item path.`, field);
  }
  function requiredFields(value: JsonValue | undefined, sends: string[], use: ServiceUse, prefix = "", seen = new Set<Obj>()): void {
    const schema = supportedSchema(value, use); if (!schema) return;
    if (seen.has(schema) || seen.size >= 50) { add(use, "unknown", "recursive_schema", "Cannot fully verify a recursive request schema."); return; }
    const next = new Set(seen); next.add(schema);
    if (schema.type === "array") {
      requiredFields(schema.items, sends, use, prefix, next);
      return;
    }
    if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every((v) => typeof v === "string"))) {
      add(use, "unknown", "invalid_required", "Cannot interpret required request fields."); return;
    }
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (required.length && !isObj(schema.properties)) { add(use, "unknown", "properties_unknown", "Cannot determine required request properties."); return; }
    for (const key of required) {
      if (typeof key !== "string") continue;
      const full = prefix ? `${prefix}.${key}` : key;
      const present = sends.some((field) => field === full || field.startsWith(`${full}.`) || field.startsWith(`${full}[].`));
      if (!present) add(use, "incompatible", "required_request_missing", `Required request field ${full} is not listed in sends.`, full);
      else if (isObj(schema.properties)) {
        const prop = resolve(schema.properties[key]);
        if (prop && (prop.type === "object" || isObj(prop.properties))) requiredFields(prop, sends, use, full, next);
        else if (prop?.type === "array" && sends.some((field) => field.startsWith(`${full}[].`))) requiredFields(prop.items, sends, use, `${full}[]`, next);
      }
    }
  }
  for (const use of uses) {
    const paths = definition.paths;
    if (!isObj(paths)) { add(use, "unknown", "paths_unknown", "OpenAPI paths are missing or invalid."); continue; }
    const pathItem = resolve(paths[use.path]);
    if (!Object.hasOwn(paths, use.path)) { add(use, "incompatible", "endpoint_missing", `Path ${use.path} is not declared.`); continue; }
    if (!pathItem) { add(use, "unknown", "path_unresolved", "Path definition cannot be resolved."); continue; }
    const operation = resolve(pathItem[use.method.toLowerCase()]);
    if (pathItem[use.method.toLowerCase()] === undefined) { add(use, "incompatible", "method_missing", `${use.method} is not declared for ${use.path}.`); continue; }
    if (!operation) { add(use, "unknown", "operation_unresolved", "Operation cannot be resolved."); continue; }
    if (operation.security !== undefined || definition.security !== undefined) add(use, "unknown", "security_unverified", "Authentication requirements cannot be verified from consumer YAML.");
    const parameters = new Map<string, Obj>();
    let parametersUnknown = false;
    for (const source of [pathItem.parameters, operation.parameters]) {
      if (source === undefined) continue;
      if (!Array.isArray(source)) { parametersUnknown = true; continue; }
      for (const raw of source) {
        const param = resolve(raw);
        if (!param || typeof param.name !== "string" || typeof param.in !== "string") { parametersUnknown = true; continue; }
        parameters.set(`${param.in}:${param.name}`, param);
      }
    }
    if (parametersUnknown) add(use, "unknown", "parameters_unresolved", "Some parameters cannot be resolved.");
    for (const param of parameters.values()) {
      if (!["path", "query", "header", "cookie"].includes(String(param.in))) add(use, "unknown", "parameter_location", "A parameter uses an unsupported location.");
      if (use.sends.includes(String(param.name)) && (param.content !== undefined || param.schema === undefined)) add(use, "unknown", "parameter_schema", `Cannot verify the schema of parameter ${param.name}.`);
      else if (use.sends.includes(String(param.name)) && param.schema !== undefined) supportedSchema(param.schema, use);
      if ((param.required === true || param.in === "path") && typeof param.name === "string" && !use.sends.includes(param.name)) add(use, "incompatible", "required_parameter_missing", `Required ${param.in} parameter ${param.name} is not listed in sends.`, param.name);
    }
    const templateNames = [...use.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    for (const name of templateNames) {
      if (!use.sends.includes(name)) add(use, "incompatible", "path_parameter_missing", `Path parameter ${name} is not listed in sends.`, name);
      if (!parameters.has(`path:${name}`)) add(use, "unknown", "path_parameter_undeclared", `Path parameter ${name} has no declared parameter schema.`, name);
    }
    const body = operation.requestBody === undefined ? undefined : resolve(operation.requestBody);
    if (operation.requestBody !== undefined && !body) add(use, "unknown", "request_unresolved", "Request body cannot be resolved.");
    const content = body && isObj(body.content) ? body.content : undefined;
    const jsonBody = content && isObj(content["application/json"]) ? content["application/json"] : undefined;
    if (body && !jsonBody) add(use, "unknown", "request_media", "Request body is not defined as application/json.");
    const bodyFields = use.sends.filter((field) => ![...parameters.values()].some((param) => param.name === field) && !templateNames.includes(field));
    if (bodyFields.length && operation.requestBody === undefined && !parametersUnknown) for (const field of bodyFields) add(use, "incompatible", "send_not_declared", `Sent field ${field} is not a declared parameter or request body field.`, field);
    if (jsonBody) {
      for (const field of bodyFields) checkField(jsonBody.schema, field, use, false);
      if (body?.required === true && bodyFields.length === 0) add(use, "incompatible", "body_missing", "Required request body is not represented in sends.");
      if (bodyFields.length || body?.required === true) requiredFields(jsonBody.schema, bodyFields, use);
    }
    const responses = operation.responses;
    if (!isObj(responses)) { add(use, "unknown", "responses_unknown", "Operation responses are missing or invalid."); continue; }
    const success = Object.entries(responses).filter(([key]) => /^2\d\d$/.test(key));
    if (Object.keys(responses).some((key) => /^2XX$/i.test(key) || key === "default")) add(use, "unknown", "response_status_unknown", "Wildcard or default response cannot be fully verified.");
    if (!success.length) { add(use, "unknown", "success_response_missing", "No explicit success response is declared."); continue; }
    for (const [status, raw] of success) {
      const response = resolve(raw);
      if (!response) { add(use, "unknown", "response_unresolved", `Response ${status} cannot be resolved.`); continue; }
      if (!use.reads.length) continue;
      const responseContent = isObj(response.content) ? response.content : undefined;
      const json = responseContent && isObj(responseContent["application/json"]) ? responseContent["application/json"] : undefined;
      if (!json) { add(use, "unknown", "response_media", `Response ${status} does not declare an application/json schema.`); continue; }
      for (const field of use.reads) checkField(json.schema, field, use, true);
    }
  }
  return { status: issues.some((i) => i.status === "incompatible") ? "incompatible" : issues.length ? "unknown" : "match", issues };
}
