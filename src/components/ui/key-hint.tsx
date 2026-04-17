/**
 * KeyHint — the canonical keyboard shortcut annotation.
 *
 * Renders one or more keys using a semantic `<kbd>` element. Two variants:
 *
 *   - `chip` (default): boxed, self-contained. Use for reference lists,
 *     tooltips, command palettes, settings screens.
 *   - `inline`: bracketed mono text ([K] or [⌘K]) that inherits the
 *     surrounding text colour. Use inside coloured buttons or running
 *     copy where a hard-edged chip would compete with the container.
 *
 * Always mono (JetBrains Mono) at `text-[11px]` per the design system.
 * Screen readers announce modifier names via `aria-label`.
 *
 * See `.interface-design/system.md` § Keyboard Annotations for rationale.
 */
import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export type KeyHintVariant = "chip" | "inline";

interface KeyHintProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** Single key or ordered combo. Use canonical glyphs for modifiers. */
  keys: string | string[];
  variant?: KeyHintVariant;
}

// Modifier glyph → spoken name. Used to build an accessible label so
// screen readers don't read `⌘` as "place of interest sign".
const GLYPH_NAMES: Record<string, string> = {
  "⌘": "Command",
  "⌥": "Option",
  "⇧": "Shift",
  "⌃": "Control",
  "↵": "Enter",
  "⏎": "Enter",
  "⌫": "Backspace",
  "␣": "Space",
  "⎋": "Escape",
  "→": "Right arrow",
  "←": "Left arrow",
  "↑": "Up arrow",
  "↓": "Down arrow",
  "⇥": "Tab",
};

function toAriaLabel(keys: string[]): string {
  const spoken = keys.map((k) => GLYPH_NAMES[k] ?? k);
  return spoken.length === 1 ? spoken[0] : `Press ${spoken.join(" then ")}`;
}

export function KeyHint({
  keys,
  variant = "chip",
  className,
  ...rest
}: KeyHintProps) {
  const list = Array.isArray(keys) ? keys : [keys];
  const ariaLabel = rest["aria-label"] ?? toAriaLabel(list);

  if (variant === "inline") {
    return (
      <kbd
        aria-label={ariaLabel}
        className={cn(
          "font-mono text-[11px] not-italic tabular-nums opacity-70",
          className
        )}
        {...rest}
      >
        [{list.join("")}]
      </kbd>
    );
  }

  // chip variant — one <kbd> wrapper containing one chip per key so
  // screen readers still get a single semantic unit.
  return (
    <kbd
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-[4px]", className)}
      {...rest}
    >
      {list.map((key, i) => (
        <span
          key={i}
          className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-[5px] rounded-[3px] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] font-mono text-[11px] text-text-2 leading-none"
        >
          {key}
        </span>
      ))}
    </kbd>
  );
}
