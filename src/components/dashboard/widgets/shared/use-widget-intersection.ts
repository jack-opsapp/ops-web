"use client";

import { useState, useEffect, useCallback, type RefObject } from "react";

/**
 * Observes when a widget element enters the viewport (once).
 *
 * Uses a retry loop to handle the common case where ref.current is null
 * on the first effect run (element hasn't mounted yet). Checks every
 * animation frame until the ref is populated, then attaches the observer.
 */
export function useWidgetIntersection(
  ref: RefObject<Element | null>,
  threshold = 0.1
): boolean {
  const [hasIntersected, setHasIntersected] = useState(false);

  useEffect(() => {
    if (hasIntersected) return;

    let rafId: number;
    let observer: IntersectionObserver | null = null;

    function tryObserve() {
      const el = ref.current;
      if (!el) {
        // Element not mounted yet — retry next frame
        rafId = requestAnimationFrame(tryObserve);
        return;
      }

      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              setHasIntersected(true);
              observer?.disconnect();
            }
          }
        },
        { threshold }
      );

      observer.observe(el);
    }

    tryObserve();

    return () => {
      cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, [ref, threshold, hasIntersected]);

  return hasIntersected;
}
