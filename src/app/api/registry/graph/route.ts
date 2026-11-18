import { getMongoDb } from "@/lib/mongodb";
import { buildRegistryGraph } from "@/lib/analysis/graph";

export const runtime = "nodejs";
export async function GET() {
  try { return Response.json({ data: await buildRegistryGraph(getMongoDb()) }); }
  catch (error) {
    console.error("Registry graph analysis failed:", error);
    return Response.json({ error: "Unable to analyze the registry." }, { status: 500 });
  }
}
