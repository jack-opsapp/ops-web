import * as React from "react";
import { emailTokens as T } from "./tokens";

interface SpacerProps {
  size: "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
}

export function Spacer({ size }: SpacerProps) {
  const h = T.spacing[size];
  return <div style={{ height: h, lineHeight: h, fontSize: "1px" }}>&nbsp;</div>;
}
