import { EntityDetail } from "@/components/entity-detail";

export default async function ServiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EntityDetail key={id} kind="services" id={id} />;
}
