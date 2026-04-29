import * as React from "react";
import { Text } from "@react-email/components";
import { emailTokens as T } from "./tokens";

interface ParagraphProps {
  children: React.ReactNode;
  small?: boolean;
  onDark?: boolean;
}

export function Paragraph({ children, small, onDark }: ParagraphProps) {
  const color = onDark
    ? small
      ? T.color.inkTextMeta
      : T.color.inkTextPrimary
    : small
    ? T.color.paperTextSecondary
    : T.color.paperTextPrimary;
  return (
    <Text
      style={{
        margin: `0 0 ${T.spacing.sm} 0`,
        fontFamily: T.font.sans,
        fontSize: small ? T.size.small : T.size.body,
        lineHeight: small ? T.size.smallLine : T.size.bodyLine,
        fontWeight: T.weight.regular,
        color,
      }}
    >
      {children}
    </Text>
  );
}
