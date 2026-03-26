"use client";

import { useEffect } from "react";
import { useAuthStore, selectIsAdmin } from "@/lib/store/auth-store";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { useGmailConnections } from "@/lib/hooks/use-gmail-connections";
import { useCreateNotification } from "@/lib/hooks/use-notifications";

/**
 * Evaluates conditions and creates setup-prompt notifications in the rail.
 * Deduplication is handled by NotificationService.create (same type+title = skip).
 * Mount once in the dashboard layout via a wrapper component.
 */
export function useActionPrompts() {
  const isAdmin = useAuthStore(selectIsAdmin);
  const company = useAuthStore((s) => s.company);
  const notify = useCreateNotification();

  const { data: gmailData, isLoading: gmailLoading } = useGmailConnections();
  const { data: teamData, isLoading: teamLoading } = useTeamMembers();

  useEffect(() => {
    // Wait for data to load
    if (gmailLoading || teamLoading) return;

    // ── Connect Gmail ──────────────────────────────────────────────────
    if (
      isAdmin &&
      gmailData !== undefined &&
      Array.isArray(gmailData) &&
      gmailData.length === 0
    ) {
      notify({
        type: "setup_prompt",
        title: "Connect Gmail",
        body: "Automate your pipeline by connecting your inbox.",
        actionUrl: "/settings?tab=integrations",
        actionLabel: "Set up",
      });
    }

    // ── Invite Team ────────────────────────────────────────────────────
    const size = company?.companySize;
    const hasTeamSize =
      size !== null && size !== undefined && size !== "" && size !== "just-me";
    const fewMembers = !teamData || teamData.users.length <= 1;

    if (hasTeamSize && fewMembers) {
      notify({
        type: "setup_prompt",
        title: "Invite your team",
        body: "Get your crew on OPS so everyone stays in sync.",
        actionUrl: "/settings?tab=team&action=invite",
        actionLabel: "Invite",
      });
    }
  }, [
    isAdmin,
    company?.companySize,
    gmailData,
    gmailLoading,
    teamData,
    teamLoading,
    notify,
  ]);
}
