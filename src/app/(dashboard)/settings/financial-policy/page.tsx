import { FinancialPolicyPanel } from "@/components/agent/financial-policy-panel";

export default async function FinancialPolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const { source } = await searchParams;
  return (
    <div className="p-3">
      <FinancialPolicyPanel key={source ?? "current"} sourceId={source} />
    </div>
  );
}
