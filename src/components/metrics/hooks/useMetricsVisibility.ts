"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_PREFIX = "ops-metrics-visible-";

export function useMetricsVisibility(tabId: string) {
  const key = `${STORAGE_PREFIX}${tabId}`;

  const [isVisible, setIsVisible] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(key);
    return stored === null ? true : stored === "true";
  });

  useEffect(() => {
    localStorage.setItem(key, String(isVisible));
  }, [key, isVisible]);

  const toggle = useCallback(() => setIsVisible((v) => !v), []);
  const hide = useCallback(() => setIsVisible(false), []);
  const show = useCallback(() => setIsVisible(true), []);

  return { isVisible, toggle, hide, show };
}
