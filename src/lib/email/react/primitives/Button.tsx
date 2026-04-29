import * as React from "react";
import { Button as RButton } from "@react-email/components";
import { emailTokens as T } from "./tokens";

interface ButtonProps {
  href: string;
  children: React.ReactNode;
  /**
   * Portal override — when provided, button fill and border use this color.
   * Used by PortalEmailLayout-based templates.
   */
  accentColor?: string;
}

export function Button({ href, children, accentColor }: ButtonProps) {
  const fill = accentColor ?? T.color.ink;
  return (
    <RButton
      href={href}
      style={{
        background: fill,
        color: T.color.white,
        padding: `${T.layout.buttonPaddingY} ${T.layout.buttonPaddingX}`,
        fontFamily: T.font.label,
        fontSize: T.size.ctaLabel,
        fontWeight: T.weight.regular,
        letterSpacing: T.tracking.ctaLabel,
        textTransform: "uppercase",
        textDecoration: "none",
        borderRadius: T.layout.buttonRadius,
        display: "inline-block",
        border: `1px solid ${fill}`,
        lineHeight: 1,
      }}
    >
      {children}
    </RButton>
  );
}
