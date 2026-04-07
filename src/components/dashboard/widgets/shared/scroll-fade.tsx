"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface ScrollFadeProps {
  children: ReactNode;
  className?: string;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}

/**
 * Scrollable container with top/bottom gradient fade indicators.
 * Shows a fade at the top when scrolled down, and at the bottom when
 * there is more content below. Fades out when at the respective edge.
 *
 * Replaces `<div className="flex-1 overflow-y-auto scrollbar-hide">`.
 */
export function ScrollFade({ children, className, onScroll }: ScrollFadeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [showTop, setShowTop] = useState(false);
  const [showBottom, setShowBottom] = useState(false);

  const check = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setShowTop(el.scrollTop > 4);
    setShowBottom(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  }, []);

  useEffect(() => {
    check();
    // Re-check when children change (data loads, list updates)
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [check]);

  return (
    <div className="relative flex-1 min-h-0">
      {/* Top fade */}
      <div
        className={cn(
          "absolute top-0 left-0 right-0 h-5 z-[1] pointer-events-none transition-opacity duration-200",
          showTop ? "opacity-100" : "opacity-0"
        )}
        style={{
          background: "linear-gradient(to bottom, rgba(10, 10, 10, 0.95), transparent)",
        }}
      />

      {/* Scrollable content */}
      <div
        ref={ref}
        onScroll={(e) => { check(); onScroll?.(e); }}
        className={cn("h-full overflow-y-auto scrollbar-hide", className)}
      >
        {children}
      </div>

      {/* Bottom fade */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 h-5 z-[1] pointer-events-none transition-opacity duration-200",
          showBottom ? "opacity-100" : "opacity-0"
        )}
        style={{
          background: "linear-gradient(to top, rgba(10, 10, 10, 0.95), transparent)",
        }}
      />
    </div>
  );
}
