import { getMongoDb } from "@/lib/mongodb";
import { analyzeDefinition } from "@/lib/analysis/graph";
import { RegistryError } from "@/lib/registry/errors";
import { validateId } from "@/lib/registry/input";
import { RegistryRepository } from "@/lib/registry/repository";
import { COLLECTIONS } from "@/lib/registry/schema";
import type { ApiVersion, RegistryEntry, ServiceVersion } from "@/lib/registry/types";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; definitionId: string }> }) {
  try {
    const { id, definitionId } = await params;
    validateId(id); validateId(definitionId);
    const db = getMongoDb();
    const definition = await new RegistryRepository(db).getDefinition("services", id, definitionId) as ServiceVersion;
    const [apis, versions] = await Promise.all([
      db.collection<RegistryEntry>(COLLECTIONS.apis).find().sort({ name: 1 }).toArray(),
      db.collection<ApiVersion>(COLLECTIONS.apiVersions).find().sort({ createdAt: 1, _id: 1 }).toArray(),
    ]);
    return Response.json({ data: analyzeDefinition(id, definition, apis, versions) });
  } catch (error) {
    if (error instanceof RegistryError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Service analysis failed:", error);
    return Response.json({ error: "Unable to analyze the service definition." }, { status: 500 });
  }
}
