import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * WidgetTitle — the canonical dashboard widget header label.
 *
 * DESIGN.md §10 (widget anatomy): the HEADER zone reads `// TITLE` in
 * JetBrains Mono 11px uppercase, muted `//` slash prefix, tracking-[0.16em],
 * text-text-3. This is the same `// LABEL` section-label grammar used by the
 * InstrumentStrip tiles and the drawer/panel headers conformed in P3-3, so
 * every OPS surface speaks one section-label voice.
 *
 * Use for a widget's identity/header title ONLY — never for footers
 * ("VIEW ALL"), Cake sub-labels, or stat captions, which keep their own roles.
 *
 * Pass per-instance layout classes (mt-1, block, etc.) via `className`.
 */
export function WidgetTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-micro uppercase tracking-[0.16em] text-text-3",
        className,
      )}
    >
      <span className="text-text-mute">{"// "}</span>
      {children}
    </span>
  );
}
