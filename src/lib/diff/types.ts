import type { JsonValue } from "../registry/types";

export type DiffCategory = "parameters" | "request" | "responses" | "schemas" | "components" | "paths" | "other";
export type DiffAction = "added" | "removed" | "changed";

/** `before`/`after` are omitted only when the value did not exist; null is a valid value. */
export interface DiffChange {
  category: DiffCategory;
  action: DiffAction;
  path: string[];
  before?: JsonValue;
  after?: JsonValue;
}

export interface VersionComparison {
  from: { id: string; version: string; sourceFile?: string; createdAt: string };
  to: { id: string; version: string; sourceFile?: string; createdAt: string };
  changes: DiffChange[];
  truncated: boolean;
}
