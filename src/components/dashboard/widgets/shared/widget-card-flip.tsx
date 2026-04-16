"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useReducedMotion } from "./use-reduced-motion";
import { ScrollFade } from "./scroll-fade";
import {
  WIDGET_FLIP_DURATION,
  WIDGET_EASE_CSS,
  WIDGET_DURATION_FAST,
} from "./widget-motion";

// ── Types ────────────────────────────────────────────────────────────

interface WidgetCardFlipProps {
  /** Normal widget content (front face) */
  front: ReactNode;
  /** Info content shown on the back face */
  backContent: {
    title: string;
    description: string;
    dataSource: string;
  };
  /** Whether the card is currently flipped to show back */
  isFlipped: boolean;
  /** Toggle flip state */
  onFlip: () => void;
}

// ── Component ────────────────────────────────────────────────────────

export function WidgetCardFlip({
  front,
  backContent,
  isFlipped,
  onFlip,
}: WidgetCardFlipProps) {
  const reducedMotion = useReducedMotion();

  // Reduced motion: crossfade instead of 3D flip
  if (reducedMotion) {
    return (
      <div className="relative h-full w-full">
        <div
          className="absolute inset-0"
          style={{
            opacity: isFlipped ? 0 : 1,
            pointerEvents: isFlipped ? "none" : "auto",
            transition: `opacity ${WIDGET_DURATION_FAST}ms ease`,
          }}
        >
          {front}
        </div>
        <div
          className="absolute inset-0"
          style={{
            opacity: isFlipped ? 1 : 0,
            pointerEvents: isFlipped ? "auto" : "none",
            transition: `opacity ${WIDGET_DURATION_FAST}ms ease`,
          }}
        >
          <CardBack content={backContent} onClose={onFlip} />
        </div>
      </div>
    );
  }

  // Full 3D flip
  return (
    <div className="relative h-full w-full" style={{ perspective: "600px" }}>
      <div
        className="relative h-full w-full"
        style={{
          transformStyle: "preserve-3d",
          transition: `transform ${WIDGET_FLIP_DURATION}ms ${WIDGET_EASE_CSS}`,
          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* Front face */}
        <div
          className="absolute inset-0"
          style={{ backfaceVisibility: "hidden" }}
        >
          {front}
        </div>
        {/* Back face */}
        <div
          className="absolute inset-0"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <CardBack content={backContent} onClose={onFlip} />
        </div>
      </div>
    </div>
  );
}

// ── Back Face ────────────────────────────────────────────────────────

function CardBack({
  content,
  onClose,
}: {
  content: { title: string; description: string; dataSource: string };
  onClose: () => void;
}) {
  return (
    <div className="h-full rounded-[5px] border border-border-subtle bg-[rgba(10,10,10,0.90)] backdrop-blur-[20px] saturate-[1.2]">
      <div className="h-full flex flex-col p-3 relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors"
        >
          <X className="w-[14px] h-[14px] text-text-3" />
        </button>
        <span className="font-kosugi text-micro uppercase tracking-wider text-text-3 shrink-0">
          {content.title}
        </span>
        <ScrollFade className="flex-1 min-h-0 mt-1.5">
          <p className="font-mohave text-caption-sm text-text-2 leading-relaxed">
            {content.description}
          </p>
        </ScrollFade>
        <span className="font-mono text-micro text-text-mute mt-1 shrink-0">
          {content.dataSource}
        </span>
      </div>
    </div>
  );
}
