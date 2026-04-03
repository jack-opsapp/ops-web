"use client";

import { useEffect, type RefObject } from "react";

/**
 * Listens for scroll events on the first `.overflow-y-auto` child of the given
 * container ref and forwards the scrollTop to the provided callback. Used by
 * widgets that collapse their hero section on scroll.
 */
export function useScrollFadeScroll(
  containerRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onScroll: (scrollTop: number) => void
) {
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;
    const scrollEl = container.querySelector(".overflow-y-auto");
    if (!scrollEl) return;

    const handler = () => onScroll(scrollEl.scrollTop);
    scrollEl.addEventListener("scroll", handler, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handler);
  }, [containerRef, enabled, onScroll]);
}
