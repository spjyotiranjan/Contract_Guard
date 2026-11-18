import { controller } from "@/lib/registry/controller";

export const runtime = "nodejs";
export const GET = () => controller.list("services");
export const POST = (request: Request) => controller.create(request, "services");
