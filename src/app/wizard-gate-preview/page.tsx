// DEV PREVIEW — standalone harness for the catalog-setup PrerequisiteGate /
// GatePanel (plan Task 6.10 + 6.3). Renders the calm blocker panel in each of its
// five reasons (the four prerequisites + the single-session lock) with no auth
// and no database — pure component — so the blocked states can be screenshotted
// or curl-verified via the dev server at /wizard-gate-preview?reason=<reason>.
// Deliberately NOT under /catalog (a protected prefix) and not linked anywhere;
// sits outside every protected middleware prefix, so no auth gate fires. The
// server page picks the initial reason from the query so each state renders
// server-side; the client control bar cycles them in the browser.

import { GatePreview } from "./gate-preview-client";
import type { GateReason } from "@/components/catalog-setup/prerequisite-gate";

const REASONS: GateReason[] = [
  "no_company",
  "baseline_not_seeded",
  "catalog_surface_absent",
  "subscription_locked",
  "session_locked",
];

export default async function WizardGatePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const sp = await searchParams;
  const reason: GateReason = REASONS.includes(sp.reason as GateReason)
    ? (sp.reason as GateReason)
    : "baseline_not_seeded";
  return <GatePreview initialReason={reason} />;
}
