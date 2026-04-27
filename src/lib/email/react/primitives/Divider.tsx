import * as React from "react";
import { Hr } from "@react-email/components";
import { emailTokens as T } from "./tokens";

interface DividerProps {
  spacing?: "sm" | "md" | "lg";
  onDark?: boolean;
}

export function Divider({ spacing = "md", onDark }: DividerProps) {
  const gap =
    spacing === "sm"
      ? T.spacing.sm
      : spacing === "lg"
      ? T.spacing.lg
      : T.spacing.md;
  return (
    <Hr
      style={{
        border: "none",
        borderTop: `1px solid ${onDark ? T.color.inkRule : T.color.paperRule}`,
        margin: `${gap} 0`,
      }}
    />
  );
}
