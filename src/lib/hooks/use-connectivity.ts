/**
 * OPS Web - Connectivity Monitor Hook
 *
 * Tracks online/offline status using browser navigator.onLine API.
 * Shows toast notifications on connectivity changes.
 */

import { useState, useEffect } from "react";
import { toast } from "@/components/ui/toast";
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
      toast.success(t("connectivity.online", "BACK ONLINE"), { id: "connectivity" });
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
