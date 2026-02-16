/**
 * OPS Web - Connectivity Monitor Hook
 *
 * Tracks online/offline status using browser navigator.onLine API.
 * Shows toast notifications on connectivity changes.
 */

import { useState, useEffect } from "react";
import { toast } from "sonner";

export function useConnectivity() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      toast.success("Back online", { id: "connectivity" });
    }

    function handleOffline() {
      setIsOnline(false);
      toast.error("No internet connection", {
        id: "connectivity",
        duration: Infinity,
        description: "Changes will sync when connection is restored.",
      });
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
