import { ProspectSheet } from "@/components/pmf/prospect-sheet";

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProspectSheet prospectId={id} />;
}
