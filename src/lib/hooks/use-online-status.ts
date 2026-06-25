"use client";

/**
 * Reports the browser's online/offline status, reactively. The catalog setup
 * wizard uses it to surface the offline banner and HOLD commits while offline
 * (spec §16 "Offline") — staged cards are safe client-side; nothing is lost,
 * the commit just waits for connectivity to return.
 */

import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // Re-sync in case the status changed between initial render and effect.
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
