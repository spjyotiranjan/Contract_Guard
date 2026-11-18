import type { JsonObject, JsonValue } from "../registry/types";
import type { DiffAction, DiffCategory, DiffChange } from "./types";

const MAX_CHANGES = 5000;

function category(path: string[]): DiffCategory {
  if (path[0] === "components") return path[1] === "schemas" ? "schemas" : "components";
  if (path[0] !== "paths") return "other";
  if (path.includes("parameters")) return "parameters";
  if (path.includes("requestBody")) return "request";
  if (path.includes("responses")) return "responses";
  return "paths";
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Parameter identity is defined by (in, name); references use their literal $ref.
function parameterKey(value: JsonValue): string | null {
  if (!isObject(value)) return null;
  if (typeof value.$ref === "string") return `$ref:${value.$ref}`;
  return typeof value.in === "string" && typeof value.name === "string" ? `${value.in}:${value.name}` : null;
}

function keyedParameters(values: JsonValue[]): Map<string, JsonValue> | null {
  const map = new Map<string, JsonValue>();
  for (const item of values) {
    const key = parameterKey(item);
    if (key === null || map.has(key)) return null;
    map.set(key, item);
  }
  return map;
}

function scalarSet(values: JsonValue[]): Map<string, JsonValue> | null {
  const result = new Map<string, JsonValue>();
  for (const value of values) {
    if (value !== null && typeof value === "object") return null;
    const key = JSON.stringify(value);
    if (result.has(key)) return null;
    result.set(key, value);
  }
  return result;
}

/** Structural OpenAPI comparison. No references are resolved and compatibility is not inferred. */
export function compareDefinitions(before: JsonObject, after: JsonObject): { changes: DiffChange[]; truncated: boolean } {
  const changes: DiffChange[] = [];
  let truncated = false;
  function emit(action: DiffAction, path: string[], oldValue?: JsonValue, newValue?: JsonValue) {
    if (changes.length >= MAX_CHANGES) { truncated = true; return; }
    const change: DiffChange = { action, category: category(path), path };
    if (action !== "added") change.before = oldValue;
    if (action !== "removed") change.after = newValue;
    changes.push(change);
  }
  function compareMaps(oldMap: Map<string, JsonValue>, newMap: Map<string, JsonValue>, path: string[], label: (key: string) => string) {
    const keys = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort();
    for (const key of keys) {
      if (truncated) return;
      const child = [...path, label(key)];
      if (!oldMap.has(key)) emit("added", child, undefined, newMap.get(key));
      else if (!newMap.has(key)) emit("removed", child, oldMap.get(key));
      else walk(oldMap.get(key)!, newMap.get(key)!, child);
    }
  }
  function walk(oldValue: JsonValue, newValue: JsonValue, path: string[]) {
    if (truncated || oldValue === newValue) return;
    if (isObject(oldValue) && isObject(newValue)) {
      compareMaps(new Map(Object.entries(oldValue)), new Map(Object.entries(newValue)), path, (key) => key);
      return;
    }
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      const field = path[path.length - 1];
      if (field === "parameters") {
        const oldMap = keyedParameters(oldValue); const newMap = keyedParameters(newValue);
        if (oldMap && newMap) { compareMaps(oldMap, newMap, path, (key) => `[${key}]`); return; }
      }
      if (field === "required" || field === "enum") {
        const oldMap = scalarSet(oldValue); const newMap = scalarSet(newValue);
        if (oldMap && newMap) { compareMaps(oldMap, newMap, path, (key) => `[${key}]`); return; }
      }
      const length = Math.max(oldValue.length, newValue.length);
      for (let index = 0; index < length && !truncated; index++) {
        const child = [...path, `[${index}]`];
        if (index >= oldValue.length) emit("added", child, undefined, newValue[index]);
        else if (index >= newValue.length) emit("removed", child, oldValue[index]);
        else walk(oldValue[index], newValue[index], child);
      }
      return;
    }
    emit("changed", path, oldValue, newValue);
  }
  walk(before, after, []);
  return { changes, truncated };
}
