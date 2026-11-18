import { EntityDetail } from "@/components/entity-detail";

export default async function ApiDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EntityDetail key={id} kind="apis" id={id} />;
}
