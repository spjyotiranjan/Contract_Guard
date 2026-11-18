import { controller } from "@/lib/registry/controller";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  return controller.getDefinition("apis", id, versionId);
}
