import type { ObjectId } from "mongodb";

/** JSON values only: YAML must be converted to JSON-compatible values. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export interface RegistryEntry {
  _id: ObjectId;
  /** Stable, unique identifier (for example, quote-api or mobile-app). */
  name: string;
  owner: string;
  createdAt: Date;
  updatedAt: Date;
}

export type Api = RegistryEntry;
export type Service = RegistryEntry;

export interface OpenApiDefinition extends JsonObject {
  openapi: string;
  info: JsonObject & { title: string; version: string };
}

export interface ServiceUse extends JsonObject {
  provider: string;
  method: string;
  path: string;
  sends: string[];
  reads: string[];
}

export interface ServiceDefinition extends JsonObject {
  consumer: string;
  team: string;
  uses: ServiceUse[];
}

export interface VersionBase {
  _id: ObjectId;
  /** Lowercase SHA-256 of the original YAML bytes, before parsing. */
  sourceHash: string;
  /** Informational source filename; not an identity or a filesystem path to load. */
  sourceFile?: string;
  createdAt: Date;
}

export interface ApiVersion extends VersionBase {
  apiId: ObjectId;
  version: string;
  definition: OpenApiDefinition;
}

/** A binding is only present when an API revision is explicitly selected. */
export interface ApiBinding {
  useIndex: number;
  apiVersionId: ObjectId;
}

export interface ServiceVersion extends VersionBase {
  serviceId: ObjectId;
  definition: ServiceDefinition;
  bindings: ApiBinding[];
}
