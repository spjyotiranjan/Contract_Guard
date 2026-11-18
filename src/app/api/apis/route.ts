import { controller } from "@/lib/registry/controller";

export const runtime = "nodejs";
export const GET = () => controller.list("apis");
export const POST = (request: Request) => controller.create(request, "apis");
