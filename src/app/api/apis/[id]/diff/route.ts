import { getMongoDb } from "@/lib/mongodb";
import { compareDefinitions } from "@/lib/diff/compare";
import type { VersionComparison } from "@/lib/diff/types";
import { RegistryError } from "@/lib/registry/errors";
import { validateId } from "@/lib/registry/input";
import { RegistryRepository } from "@/lib/registry/repository";
import type { ApiVersion } from "@/lib/registry/types";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const query = new URL(request.url).searchParams;
    const from = query.getAll("from"); const to = query.getAll("to");
    if (from.length !== 1 || to.length !== 1) throw new RegistryError(400, "Provide one from and one to version record ID.");
    validateId(id); validateId(from[0]); validateId(to[0]);
    if (from[0].toLowerCase() === to[0].toLowerCase()) throw new RegistryError(400, "Choose two different version records.");
    const repository = new RegistryRepository(getMongoDb());
    const [oldVersion, newVersion] = await Promise.all([
      repository.getDefinition("apis", id, from[0]), repository.getDefinition("apis", id, to[0]),
    ]) as [ApiVersion, ApiVersion];
    const describe = (item: ApiVersion) => ({ id: item._id.toHexString(), version: item.version, sourceFile: item.sourceFile, createdAt: item.createdAt.toISOString() });
    const result: VersionComparison = { from: describe(oldVersion), to: describe(newVersion), ...compareDefinitions(oldVersion.definition, newVersion.definition) };
    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof RegistryError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Version comparison failed:", error);
    return Response.json({ error: "Internal server error." }, { status: 500 });
  }
}
