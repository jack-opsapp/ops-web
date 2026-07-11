/**
 * OPS Web - Connectivity Monitor Hook
 *
 * Tracks online/offline status using browser navigator.onLine API.
 * Shows toast notifications on connectivity changes.
 */

import { useState, useEffect } from "react";
import { DEFAULT_TOAST_DURATION_MS, toast } from "@/components/ui/toast";
import { useDictionary } from "@/i18n/client";

export function useConnectivity() {
  // Copy lives in the topbar namespace — the hook's only consumer.
  const { t } = useDictionary("topbar");
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      // Same id updates the persistent offline toast in place. Sonner merges
      // update payloads, so the stale offline description and Infinity
      // duration must be cleared explicitly.
      toast.success(t("connectivity.online", "BACK ONLINE"), {
        id: "connectivity",
        description: undefined,
        duration: DEFAULT_TOAST_DURATION_MS,
      });
    }

    function handleOffline() {
      setIsOnline(false);
      toast.error(t("connectivity.offline", "OFFLINE"), {
        id: "connectivity",
        duration: Infinity,
        description: t(
          "connectivity.offlineDetail",
          "Changes sync when connection is restored."
        ),
      });
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [t]);

  return isOnline;
}
