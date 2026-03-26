"use client";

import { useState, useEffect, type RefObject } from "react";

export function useWidgetIntersection(
  ref: RefObject<Element | null>,
  threshold = 0.1
): boolean {
  const [hasIntersected, setHasIntersected] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || hasIntersected) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setHasIntersected(true);
            observer.disconnect();
          }
        }
      },
      { threshold }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, threshold, hasIntersected]);

  return hasIntersected;
}
