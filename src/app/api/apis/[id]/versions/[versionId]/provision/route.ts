import { getMongoDb } from "@/lib/mongodb";
import { provisionVersion } from "@/lib/receiver/provision";
import { RegistryError } from "@/lib/registry/errors";
import { validateId } from "@/lib/registry/input";
import { RegistryRepository } from "@/lib/registry/repository";
import type { ApiVersion } from "@/lib/registry/types";

export const runtime = "nodejs";
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const { id, versionId } = await params;
    validateId(id); validateId(versionId);
    const version = await new RegistryRepository(getMongoDb()).getDefinition("apis", id, versionId) as ApiVersion;
    const result = await provisionVersion(version);
    return Response.json({ data: result }, { status: result.status === "provisioned" ? 200 : 503 });
  } catch (error) {
    if (error instanceof RegistryError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Contract provisioning failed:", error);
    return Response.json({ error: "Unable to provision the contract." }, { status: 500 });
  }
}
