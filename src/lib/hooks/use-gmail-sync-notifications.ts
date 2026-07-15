/**
 * OPS Web - Gmail Sync Notifications Hook
 *
 * Periodically checks for new unread email activities and creates
 * a notification in the rail when new emails are detected. Only polls
 * while the tab is visible.
 */

"use client";

import { useRef, useEffect } from "react";
import { useAuthStore } from "../store/auth-store";
import { useCreateNotification } from "./use-notifications";
import { authedFetch } from "../utils/authed-fetch";

const POLL_INTERVAL = 60_000; // 60 seconds

export function useGmailSyncNotifications() {
  const { company } = useAuthStore();
  const companyId = company?.id;
  const lastCountRef = useRef<number | null>(null);
  const notify = useCreateNotification();

  useEffect(() => {
    if (!companyId) return;

    const check = async () => {
      if (document.visibilityState !== "visible") return;

      try {
        const resp = await authedFetch(
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
          notify({
            type: "gmail_sync",
            title: `${newCount} new email${newCount > 1 ? "s" : ""} synced`,
            body: "New emails matched to your clients",
            actionUrl: "/pipeline",
            actionLabel: "View",
          });
        }

        lastCountRef.current = currentCount;
      } catch {
        // Silently ignore network errors
      }
    };

    const interval = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [companyId, notify]);
}
