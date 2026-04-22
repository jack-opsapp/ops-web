/**
 * OPS Admin — PMF Ad Spend manual-entry page
 *
 * Wraps AdSpendForm with a slash header. Auth is enforced by /admin
 * layout — no per-page recheck needed.
 */
import { AdSpendForm } from "@/components/pmf/ad-spend-form";
import { SlashHeader } from "@/components/pmf/ui/slash-header";

export default function AdSpendPage() {
  return (
    <div className="space-y-6">
      <SlashHeader variant="page-title">AD SPEND · MANUAL ENTRY</SlashHeader>
      <AdSpendForm />
    </div>
  );
}
