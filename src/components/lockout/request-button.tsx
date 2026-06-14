"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDictionary } from "@/i18n/client";
import { requireSupabase } from "@/lib/supabase/helpers";
import {
  type NotificationType,
} from "@/lib/api/services/notification-service";
import { RequestSentRow } from "./request-sent-row";
import { useRequestCooldown } from "./hooks/use-request-cooldown";

export interface RequestButtonProps {
  reason: "subscription_expired" | "unseated";
  userId: string;
  companyId: string;
  userName: string;
  adminIds: string[];
  /** Dictionary key resolving to the button label (e.g. "lockout.expiredMember.cta"). */
  ctaKey: string;
}

export function RequestButton({
  reason,
  userId,
  companyId,
  userName,
  adminIds,
  ctaKey,
}: RequestButtonProps) {
  const { t } = useDictionary("auth");
  const cooldown = useRequestCooldown(userId);
  const [sending, setSending] = useState(false);

  const noAdmins = adminIds.length === 0;
  const isReactivation = reason === "subscription_expired";

  const handleClick = useCallback(async () => {
    if (sending || cooldown.isActive || noAdmins) return;
    setSending(true);

    try {
      const supabase = requireSupabase();
      const rows = adminIds.map((adminId) => ({
        user_id: adminId,
        company_id: companyId,
        type: "role_needed" as NotificationType,
        title: isReactivation ? "Reactivation Request" : "Access Request",
        body: isReactivation
          ? `${userName} is requesting subscription reactivation`
          : `${userName} is requesting seat restoration`,
        is_read: false,
        persistent: true,
        action_url: isReactivation ? "/settings?section=billing" : "/settings?section=team",
        action_label: isReactivation ? "Manage Subscription" : "Manage Team",
      }));

      const { error } = await supabase.from("notifications").insert(rows);
      if (!error) cooldown.setCooldown(reason);
    } catch {
      // Silently fail — admin will see a different path eventually
    } finally {
      setSending(false);
    }
  }, [
    sending,
    cooldown,
    noAdmins,
    adminIds,
    companyId,
    userName,
    reason,
    isReactivation,
  ]);

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
