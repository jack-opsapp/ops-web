"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Mail, Users } from "lucide-react";
import { useAuthStore, selectIsAdmin } from "@/lib/store/auth-store";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { useGmailConnections } from "@/lib/hooks/use-gmail-connections";
import { useActionPromptStore } from "@/stores/action-prompt-store";

/**
 * Evaluates conditions and shows relevant action prompts.
 * Mount once in the dashboard layout via a wrapper component.
 */
export function useActionPrompts() {
  const router = useRouter();
  const isAdmin = useAuthStore(selectIsAdmin);
  const company = useAuthStore((s) => s.company);
  const showPrompt = useActionPromptStore((s) => s.showPrompt);
  const isDismissed = useActionPromptStore((s) => s.isDismissed);

  const { data: gmailData, isLoading: gmailLoading } = useGmailConnections();
  const { data: teamData, isLoading: teamLoading } = useTeamMembers();

  useEffect(() => {
    // Wait for data to load
    if (gmailLoading || teamLoading) return;

    // ── Connect Gmail ──────────────────────────────────────────────────
    if (
      isAdmin &&
      !isDismissed("connect-gmail") &&
      gmailData !== undefined &&
      Array.isArray(gmailData) &&
      gmailData.length === 0
    ) {
      showPrompt({
        id: "connect-gmail",
        icon: Mail,
        title: "Connect Gmail",
        description: "Automate your pipeline by connecting your inbox.",
        ctaLabel: "Set up",
        ctaAction: () => router.push("/settings?tab=integrations"),
        persistent: true,
        dismissable: true,
        variant: "accent",
      });
    }

    // ── Invite Team ────────────────────────────────────────────────────
    const size = company?.companySize;
    const hasTeamSize =
      size !== null && size !== undefined && size !== "" && size !== "just-me";
    const fewMembers = !teamData || teamData.users.length <= 1;

    if (hasTeamSize && fewMembers && !isDismissed("invite-team")) {
      showPrompt({
        id: "invite-team",
        icon: Users,
        title: "Invite your team",
        description: "Get your crew on OPS so everyone stays in sync.",
        ctaLabel: "Invite",
        ctaAction: () => router.push("/settings?tab=team"),
        persistent: true,
        dismissable: true,
        variant: "default",
      });
    }
  }, [
    isAdmin,
    company?.companySize,
    gmailData,
    gmailLoading,
    teamData,
    teamLoading,
    isDismissed,
    showPrompt,
    router,
  ]);
}
