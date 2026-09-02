import * as React from "react";

/**
 * Drop-in replacement for `@react-email/components`' `<Preview>`.
 *
 * The stock component pads the hidden preheader to 150 characters with a
 * filler containing the bidi directional marks U+200E (LRM) and U+200F
 * (RLM). The agent-control-plane evidence normalizer
 * (`src/lib/agent-control-plane/evidence/unicode-safety.ts`) refuses those
 * outright, so OPS-sent mail landing in a monitored mailbox was captured
 * with `normalization_status='rejected'` — unreadable as evidence.
 *
 * This version keeps the mechanism — preview text plus invisible padding to
 * 150 characters so inbox snippets never reach body copy — but builds the
 * filler only from characters the normalizer passes untouched: U+00A0
 * (no-break space), U+200C (zero-width non-joiner), U+200D (zero-width
 * joiner). It also deliberately avoids U+200B/U+FEFF, which the normalizer
 * tolerates but strips. Do not swap call sites back to the stock component.
 */

const PREVIEW_MAX_LENGTH = 150;

/** NBSP + ZWNJ + ZWJ — see the module doc for why exactly these. */
const FILLER = "\u00A0\u200C\u200D";

interface PreviewProps extends React.ComponentPropsWithoutRef<"div"> {
  children?: string | string[];
}

export function Preview({ children = "", ...props }: PreviewProps) {
  const text = (
    Array.isArray(children) ? children.join("") : children
  ).substring(0, PREVIEW_MAX_LENGTH);
  return (
    <div
      style={{
        display: "none",
        overflow: "hidden",
        lineHeight: "1px",
        opacity: 0,
        maxHeight: 0,
        maxWidth: 0,
      }}
      data-skip-in-text={true}
      {...props}
    >
      {text}
      {text.length < PREVIEW_MAX_LENGTH ? (
        <div>{FILLER.repeat(PREVIEW_MAX_LENGTH - text.length)}</div>
      ) : null}
    </div>
  );
}
