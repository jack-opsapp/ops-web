"use client";

/**
 * InboxAvatar — circular monogram chip per `reference/v3-shell.jsx :: V3Avatar`.
 *
 * Default 24px (message bubbles, ledger rows). 36px size used by the
 * context rail header. Lavender (`agent`) variant for Claude-authored
 * surfaces only — never on user content.
 *
 * Per spec: avatars are the ONE place 999px / fully-round radii are allowed
 * (system.md: "No 999px pills except avatars"). Hairline border + token text
 * carry the treatment; initials render in Mohave with mild positive tracking.
 */

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type InboxAvatarSize = 24 | 32 | 36;

interface InboxAvatarProps {
  /** Display name; we extract up to 2 initials. */
  name?: string | null;
  /** Override initials directly. */
  initials?: string;
  /** Pixel size; defaults to 24 for the desktop inbox. */
  size?: InboxAvatarSize;
  /** Renders the lavender Claude tile with a Sparkles glyph. */
  agent?: boolean;
  className?: string;
}

const SIZE_CLASS: Record<InboxAvatarSize, string> = {
  24: "h-[24px] w-[24px] text-[11px]",
  32: "h-[32px] w-[32px] text-[11px]",
  36: "h-[36px] w-[36px] text-[12px]",
};

const SPARKLE_SIZE: Record<InboxAvatarSize, string> = {
  24: "h-3 w-3",
  32: "h-3.5 w-3.5",
  36: "h-3.5 w-3.5",
};

function safeInitials(name: string | null | undefined, override?: string): string {
  if (override) return override.slice(0, 2).toUpperCase();
  const seed = (name && name.trim()) || "";
  if (!seed) return "·";
  const parts = seed.split(/[\s&]+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "·";
}

export function InboxAvatar({
  name,
  initials,
  size = 24,
  agent,
  className,
}: InboxAvatarProps) {
  if (agent) {
    return (
      <span
        data-testid="inbox-avatar"
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full border border-agent-border-hi bg-transparent text-agent",
          SIZE_CLASS[size],
          className,
        )}
      >
        <Sparkles
          aria-hidden
          className={SPARKLE_SIZE[size]}
          strokeWidth={1.5}
        />
      </span>
    );
  }
  return (
    <span
      data-testid="inbox-avatar"
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-line-hi bg-transparent font-mohave tracking-[0.02em] text-text-2",
        SIZE_CLASS[size],
        className,
      )}
    >
      {safeInitials(name, initials)}
    </span>
  );
}
