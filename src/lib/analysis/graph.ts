import type { Db } from "mongodb";
import { COLLECTIONS } from "../registry/schema";
import type { ApiVersion, RegistryEntry, ServiceVersion } from "../registry/types";
import { analyzeUses } from "./analyze";
import { analyzeVariations } from "./variations";
import type { RegistryGraph } from "./types";

export function analyzeDefinition(serviceId: string, definition: ServiceVersion, apis: RegistryEntry[], versions: ApiVersion[]): RegistryGraph["connections"] {
  const apiByName = new Map(apis.map((api) => [api.name, api]));
  const providers = new Map<string, typeof definition.definition.uses>();
  for (const use of definition.definition.uses) {
    if (!providers.has(use.provider)) providers.set(use.provider, []);
    providers.get(use.provider)!.push(use);
  }
  return [...providers].map(([provider, uses]) => {
    const api = apiByName.get(provider);
    const apiId = api?._id.toHexString();
    return { serviceId, definitionId: definition._id.toHexString(), provider, apiId, useCount: uses.length,
      versions: apiId ? versions.filter((version) => version.apiId.toHexString() === apiId).map((version) => ({ versionId: version._id.toHexString(), version: version.version, sourceFile: version.sourceFile, ...analyzeUses(version.definition, uses), variations: analyzeVariations(version.definition, uses) })) : [],
    };
  });
}

/** Derived on demand: no stale compatibility records or inferred bindings are stored. */
export async function buildRegistryGraph(db: Db): Promise<RegistryGraph> {
  const [apis, services, versions, definitions] = await Promise.all([
    db.collection<RegistryEntry>(COLLECTIONS.apis).find().sort({ name: 1 }).toArray(),
    db.collection<RegistryEntry>(COLLECTIONS.services).find().sort({ name: 1 }).toArray(),
    db.collection<ApiVersion>(COLLECTIONS.apiVersions).find().sort({ createdAt: 1, _id: 1 }).toArray(),
    db.collection<ServiceVersion>(COLLECTIONS.serviceVersions).find().sort({ createdAt: -1, _id: -1 }).toArray(),
  ]);
  const versionsByApi = new Map<string, ApiVersion[]>();
  for (const version of versions) {
    const id = version.apiId.toHexString();
    if (!versionsByApi.has(id)) versionsByApi.set(id, []);
    versionsByApi.get(id)!.push(version);
  }
  const latestByService = new Map<string, ServiceVersion>();
  for (const definition of definitions) {
    const id = definition.serviceId.toHexString();
    if (!latestByService.has(id)) latestByService.set(id, definition);
  }
  const connections: RegistryGraph["connections"] = [];
  const graphServices = services.map((service) => {
    const id = service._id.toHexString();
    const latest = latestByService.get(id);
    if (latest) {
      connections.push(...analyzeDefinition(id, latest, apis, versions));
    }
    return { id, name: service.name, owner: service.owner, definitionId: latest?._id.toHexString(), sourceFile: latest?.sourceFile };
  });
  return { services: graphServices, apis: apis.map((api) => ({ id: api._id.toHexString(), name: api.name, owner: api.owner, versions: (versionsByApi.get(api._id.toHexString()) ?? []).map((version) => ({ id: version._id.toHexString(), version: version.version, sourceFile: version.sourceFile })) })), connections };
}
