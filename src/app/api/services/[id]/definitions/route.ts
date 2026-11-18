import { controller } from "@/lib/registry/controller";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  return controller.listDefinitions("services", (await params).id);
}
export async function POST(request: Request, { params }: Context) {
  return controller.upload(request, "services", (await params).id);
}
