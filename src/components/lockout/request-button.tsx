"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDictionary } from "@/i18n/client";
import { requireSupabase } from "@/lib/supabase/helpers";
import { RequestSentRow } from "./request-sent-row";
import { useRequestCooldown } from "./hooks/use-request-cooldown";

export interface RequestButtonProps {
  reason: "subscription_expired" | "unseated";
  userId: string;
  adminIds: string[];
  /** Dictionary key resolving to the button label (e.g. "lockout.expiredMember.cta"). */
  ctaKey: string;
}

export function RequestButton({
  reason,
  userId,
  adminIds,
  ctaKey,
}: RequestButtonProps) {
  const { t } = useDictionary("auth");
  const cooldown = useRequestCooldown(userId);
  const [sending, setSending] = useState(false);

  const noAdmins = adminIds.length === 0;

  const handleClick = useCallback(async () => {
    if (sending || cooldown.isActive || noAdmins) return;
    setSending(true);

    try {
      const supabase = requireSupabase();
      const { error } = await supabase.rpc(
        "request_lockout_admin_notification"
      );
      if (!error) cooldown.setCooldown(reason);
    } catch {
      // Silently fail — admin will see a different path eventually
    } finally {
      setSending(false);
    }
  }, [sending, cooldown, noAdmins, reason]);

  if (noAdmins) return null;

  if (cooldown.isActive && cooldown.sentAt) {
    return <RequestSentRow timestamp={cooldown.sentAt} />;
  }

  return (
    <Button
      variant="primary"
      size="sm"
      className="w-full"
      onClick={handleClick}
      disabled={sending}
      loading={sending}
    >
      {t(ctaKey)}
    </Button>
  );
}
