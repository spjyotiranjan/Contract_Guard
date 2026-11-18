import { controller } from "@/lib/registry/controller";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return controller.get("services", (await params).id);
}
