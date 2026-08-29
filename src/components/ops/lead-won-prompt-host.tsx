"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";
import { queryKeys } from "@/lib/api/query-client";
import { LeadWonPromptService } from "@/lib/api/services/lead-won-prompt-service";
import {
  useLeadWonPromptStore,
  type LeadWonProposal,
} from "@/stores/lead-won-prompt-store";

/**
 * Root-mounted presenter for the lead-won prompt — bug 9a89b951, web half of
 * D3 (2026-08-18 lead-project-identity design). Mounted once in
 * dashboard-layout beside the other global overlays; renders nothing until a
 * proposal is pending.
 *
 * Answer semantics (the heart of decline-once):
 *   - MARK WON  → resolve + RPC win, toast on completion.
 *   - KEEP OPEN → resolve + record the permanent decline (fires through
 *     ConfirmDialog's onCancel, which only the BUTTON triggers).
 *   - Escape    → dismiss only. Nothing is recorded anywhere; a later
 *     qualifying status change may ask again. An accidental keystroke must
 *     never bury a lead forever.
 *
 * Commits are fire-and-forget (iOS parity: the alert closes, the toast
 * reports). The dialog never shows a spinner state.
 */
export function LeadWonPromptHost() {
  const { t } = useDictionary("pipeline");
  const queryClient = useQueryClient();
  const pending = useLeadWonPromptStore((state) => state.pending);

  // Keep the last real proposal rendered through the Radix close animation so
  // the dialog does not blank out mid-exit.
  const [displayed, setDisplayed] = useState<LeadWonProposal | null>(null);
  useEffect(() => {
    if (pending) setDisplayed(pending);
  }, [pending]);

  const proposal = pending ?? displayed;
  if (!proposal) return null;

  const leadLabel = proposal.leadLabel ?? t("wonPrompt.fallbackLead");

  const invalidateLeadQueries = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.opportunities.all,
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all });
  };

  const handleConfirm = () => {
    const confirmed = useLeadWonPromptStore.getState().pending;
    if (!confirmed) return;
    useLeadWonPromptStore.getState().resolvePending();
    void LeadWonPromptService.winLinkedOpportunity(confirmed)
      .then(() => {
        invalidateLeadQueries();
        toast.success(t("wonPrompt.toastWon"));
      })
      .catch(() => {
        toast.error(t("wonPrompt.toastWonFailed"), {
          description: t("wonPrompt.toastTryAgain"),
        });
      });
  };

  const handleDecline = () => {
    const declined = useLeadWonPromptStore.getState().pending;
    if (!declined) return;
    useLeadWonPromptStore.getState().resolvePending();
    void LeadWonPromptService.declineWonPrompt(declined).catch(() => {
      // Tolerated (iOS parity): worst case the app asks once more on a
      // later qualifying transition.
    });
  };

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    // Escape (or any non-button close). Radix also routes here right after a
    // cancel-button click — by then resolvePending() has already advanced
    // the store, so this id comparison keeps a queued follow-up from being
    // swallowed. Dismissal records nothing: only KEEP OPEN is a decline.
    const current = useLeadWonPromptStore.getState().pending;
    if (current && current.opportunityId === proposal.opportunityId) {
      useLeadWonPromptStore.getState().dismissPending();
    }
  };

  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={handleOpenChange}
      title={t("wonPrompt.title")}
      description={t("wonPrompt.body").replace("{lead}", leadLabel)}
      confirmLabel={t("wonPrompt.confirm")}
      cancelLabel={t("wonPrompt.cancel")}
      variant="default"
      onConfirm={handleConfirm}
      onCancel={handleDecline}
    />
  );
}
