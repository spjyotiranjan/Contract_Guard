import { controller } from "@/lib/registry/controller";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  return controller.listDefinitions("apis", (await params).id);
}
export async function POST(request: Request, { params }: Context) {
  return controller.upload(request, "apis", (await params).id);
}
