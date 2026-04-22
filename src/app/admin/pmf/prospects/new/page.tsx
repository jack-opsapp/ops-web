import { NewProspectModal } from "@/components/pmf/new-prospect-modal";
import { SlashHeader } from "@/components/pmf/ui/slash-header";

export default function NewProspectPage() {
  return (
    <div className="space-y-6">
      <SlashHeader variant="page-title">NEW PROSPECT</SlashHeader>
      <NewProspectModal />
    </div>
  );
}
