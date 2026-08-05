"use client";

/**
 * The step between "mailbox connected" and OPS writing on the operator's
 * behalf.
 *
 * A freshly connected mailbox can read and draft, but new-lead outreach stays
 * held until someone stands behind a signature. Asking for that at the moment
 * of connection costs one screen; discovering it later costs a held lead. So
 * the step appears once, right after the connect round-trip, and only for a
 * mailbox that has nothing confirmed yet.
 *
 * It hosts the same identity card as settings — one builder, one save path.
 */

import { useEffect, useState } from "react";

import { EmailSignatureSettings } from "@/components/settings/email-signature-settings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDictionary } from "@/i18n/client";
import { useEmailSignatureConnections } from "@/lib/hooks/use-email-signature";

interface SenderIdentityConnectStepProps {
  companyId: string;
  userId: string;
  /**
   * True only on the page load that follows a completed connect. False while
   * anything else owns the screen — the import wizard runs first, and two
   * setups competing for the same moment is one too many.
   */
  active: boolean;
}

export function SenderIdentityConnectStep({
  companyId,
  userId,
  active,
}: SenderIdentityConnectStepProps) {
  const { t } = useDictionary("settings");
  const [dismissed, setDismissed] = useState(false);
  const connections = useEmailSignatureConnections({ companyId, userId });

  // The mailbox that is actually holding outreach. With one mailbox this is
  // that mailbox; with several it is the one that needs the operator.
  const target = (connections.data ?? []).find(
    (connection) => !connection.identityConfirmed
  );
  const open = active && !dismissed && Boolean(target);

  // A connect the operator answered elsewhere — the rail, another tab — should
  // not reopen this on the next render.
  useEffect(() => {
    if (!active) setDismissed(false);
  }, [active]);

  if (!target) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setDismissed(true);
      }}
    >
      <DialogContent data-testid="sender-identity-connect-step">
        <DialogHeader>
          <DialogTitle>
            {t("integrations.signature.connectStep.title", "One more thing")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "integrations.signature.connectStep.body",
              "OPS can read this inbox now. Confirm how it signs for you and new-lead replies start moving."
            )}
          </DialogDescription>
        </DialogHeader>

        <EmailSignatureSettings
          companyId={companyId}
          userId={userId}
          connectionId={target.id}
          mailbox={target.mailbox}
        />
      </DialogContent>
    </Dialog>
  );
}
