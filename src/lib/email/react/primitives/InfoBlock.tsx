import * as React from "react";
import { Section, Row, Column, Text } from "@react-email/components";
import { emailTokens as T } from "./tokens";

interface InfoBlockProps {
  label: string;
  children: React.ReactNode;
  tone?: "neutral" | "success" | "error";
}

export function InfoBlock({ label, children, tone = "neutral" }: InfoBlockProps) {
  const borderColor =
    tone === "success"
      ? T.color.success
      : tone === "error"
      ? T.color.error
      : T.color.paperRule;
  return (
    <Section
      style={{
        border: `1px solid ${borderColor}`,
        padding: T.spacing.md,
        margin: `${T.spacing.sm} 0`,
      }}
    >
      <Row>
        <Column>
          <Text
            style={{
              margin: `0 0 ${T.spacing.xs} 0`,
              fontFamily: T.font.label,
              fontSize: T.size.eyebrow,
              lineHeight: T.size.eyebrowLine,
              letterSpacing: T.tracking.eyebrow,
              textTransform: "uppercase",
              color: T.color.paperTextSecondary,
            }}
          >
            {label}
          </Text>
          <Text
            style={{
              margin: 0,
              fontFamily: T.font.sans,
              fontSize: T.size.body,
              lineHeight: T.size.bodyLine,
              color: T.color.paperTextPrimary,
            }}
          >
            {children}
          </Text>
        </Column>
      </Row>
    </Section>
  );
}
