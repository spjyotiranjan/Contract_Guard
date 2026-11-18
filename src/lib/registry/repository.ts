import { MongoServerError, ObjectId, type Db } from "mongodb";
import { COLLECTIONS } from "./schema";
import { RegistryError } from "./errors";
import { parseYaml, validateApi, validateService } from "./parse";
import type { ApiVersion, RegistryEntry, ServiceVersion } from "./types";

export type Kind = "apis" | "services";

function parseId(id: string): ObjectId {
  if (!/^[a-f\d]{24}$/i.test(id)) throw new RegistryError(400, "Invalid registry ID.");
  return new ObjectId(id);
}

export class RegistryRepository {
  constructor(private db: Db) {}

  async list(kind: Kind) {
    return this.db.collection<RegistryEntry>(COLLECTIONS[kind]).find().sort({ name: 1 }).toArray();
  }

  async create(kind: Kind, name: string, owner: string) {
    const now = new Date();
    const entry: RegistryEntry = { _id: new ObjectId(), name, owner, createdAt: now, updatedAt: now };
    try { await this.db.collection<RegistryEntry>(COLLECTIONS[kind]).insertOne(entry); }
    catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) throw new RegistryError(409, `${kind === "apis" ? "API" : "Service"} name already exists.`);
      throw error;
    }
    return entry;
  }

  async get(kind: Kind, id: string) {
    const entry = await this.db.collection<RegistryEntry>(COLLECTIONS[kind]).findOne({ _id: parseId(id) });
    if (!entry) throw new RegistryError(404, "Registry entry not found.");
    return entry;
  }

  async listDefinitions(kind: Kind, id: string) {
    const entry = await this.get(kind, id);
    return kind === "apis"
      ? this.db.collection<ApiVersion>(COLLECTIONS.apiVersions).find({ apiId: entry._id }).sort({ createdAt: -1, _id: -1 }).toArray()
      : this.db.collection<ServiceVersion>(COLLECTIONS.serviceVersions).find({ serviceId: entry._id }).sort({ createdAt: -1, _id: -1 }).toArray();
  }

  async getDefinition(kind: Kind, id: string, definitionId: string) {
    const entry = await this.get(kind, id);
    const _id = parseId(definitionId);
    const result = kind === "apis"
      ? await this.db.collection<ApiVersion>(COLLECTIONS.apiVersions).findOne({ _id, apiId: entry._id })
      : await this.db.collection<ServiceVersion>(COLLECTIONS.serviceVersions).findOne({ _id, serviceId: entry._id });
    if (!result) throw new RegistryError(404, "Definition not found.");
    return result;
  }

  async upload(kind: Kind, id: string, file: File, version?: string) {
    const entry = await this.get(kind, id);
    const { definition, sourceHash, sourceFile } = await parseYaml(file);
    const base = { _id: new ObjectId(), sourceHash, sourceFile, createdAt: new Date() };
    try {
      if (kind === "apis") {
        const apiDefinition = validateApi(definition, version);
        const record: ApiVersion = { ...base, apiId: entry._id, version: apiDefinition.info.version, definition: apiDefinition };
        const versions = this.db.collection<ApiVersion>(COLLECTIONS.apiVersions);
        if (await versions.findOne({ apiId: entry._id, version: record.version }, { projection: { _id: 1 } })) {
          throw new RegistryError(409, "This API version already exists.");
        }
        await versions.insertOne(record);
        return record;
      }
      const record: ServiceVersion = { ...base, serviceId: entry._id, definition: validateService(definition, entry.name), bindings: [] };
      await this.db.collection<ServiceVersion>(COLLECTIONS.serviceVersions).insertOne(record);
      return record;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) throw new RegistryError(409, kind === "apis" ? "This API version already exists." : "This YAML has already been uploaded to this entity.");
      throw error;
    }
  }
}
