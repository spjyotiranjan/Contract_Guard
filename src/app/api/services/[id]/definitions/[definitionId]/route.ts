import { controller } from "@/lib/registry/controller";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; definitionId: string }> }) {
  const { id, definitionId } = await params;
  return controller.getDefinition("services", id, definitionId);
}
