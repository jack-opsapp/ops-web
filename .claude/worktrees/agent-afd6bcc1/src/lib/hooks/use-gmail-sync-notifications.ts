/**
 * OPS Web - Gmail Sync Notifications Hook
 *
 * Periodically checks for new unread email activities and shows
 * an Action Prompt when new emails are detected. Only polls while
 * the tab is visible, and auto-dismisses after 10 seconds.
 */

"use client";

import { useRef, useEffect } from "react";
import { useAuthStore } from "../store/auth-store";
import { useActionPromptStore } from "@/stores/action-prompt-store";
import { Mail } from "lucide-react";

const POLL_INTERVAL = 60_000; // 60 seconds
const PROMPT_ID = "gmail-sync-notification";

export function useGmailSyncNotifications() {
  const { company } = useAuthStore();
  const companyId = company?.id;
  const lastCountRef = useRef<number | null>(null);
  const showPrompt = useActionPromptStore((s) => s.showPrompt);

  useEffect(() => {
    if (!companyId) return;

    const check = async () => {
      if (document.visibilityState !== "visible") return;

      try {
        const resp = await fetch(
          `/api/integrations/gmail/review-items?companyId=${encodeURIComponent(companyId)}`
        );
        if (!resp.ok) return;

        const data = await resp.json();
        const items = Array.isArray(data.items) ? data.items : [];
        const currentCount = items.length;

        // On first poll, just record the baseline count
        if (lastCountRef.current === null) {
          lastCountRef.current = currentCount;
          return;
        }

        // Only notify when the count has increased since last check
        const newCount = currentCount - lastCountRef.current;
        if (newCount > 0) {
          showPrompt({
            id: PROMPT_ID,
            icon: Mail,
            title: `${newCount} new email${newCount > 1 ? "s" : ""} synced`,
            description: "New emails matched to your clients",
            ctaLabel: "View",
            ctaAction: () => {
              window.location.href = "/pipeline";
            },
            persistent: false,
            dismissable: true,
            autoDismissMs: 10000,
          });
        }

        lastCountRef.current = currentCount;
      } catch {
        // Silently ignore network errors
      }
    };

    const interval = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [companyId, showPrompt]);
}
