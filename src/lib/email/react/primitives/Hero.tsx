import * as React from "react";
import { Section, Row, Column, Text, Img } from "@react-email/components";
import { emailTokens as T } from "./tokens";

interface HeroProps {
  eyebrow?: string;
  variant: "ops" | "portal";
  logoUrl?: string | null;
  companyName?: string;
  accentColor?: string;
}

export function Hero({
  eyebrow,
  variant,
  logoUrl,
  companyName,
}: HeroProps) {
  return (
    <Section
      style={{
        background: T.color.ink,
        padding: `${T.layout.bandPaddingY} ${T.layout.bandPaddingX}`,
      }}
    >
      <Row>
        <Column>
          {variant === "ops" ? (
            <Text
              style={{
                margin: 0,
                fontFamily: T.font.sans,
                fontSize: "18px",
                fontWeight: T.weight.bold,
                letterSpacing: "4px",
                textTransform: "uppercase",
                color: T.color.white,
                lineHeight: 1,
              }}
            >
              OPS
            </Text>
          ) : logoUrl ? (
            <Img
              src={logoUrl}
              alt={companyName ?? "Company"}
              style={{
                maxHeight: "32px",
                maxWidth: "200px",
                display: "block",
              }}
            />
          ) : (
            <Text
              style={{
                margin: 0,
                fontFamily: T.font.sans,
                fontSize: "20px",
                fontWeight: T.weight.semibold,
                color: T.color.white,
                lineHeight: 1.2,
              }}
            >
              {companyName ?? ""}
            </Text>
          )}
        </Column>
      </Row>
      {eyebrow ? (
        <Row>
          <Column style={{ paddingTop: T.spacing.lg }}>
            <Text
              style={{
                margin: 0,
                fontFamily: T.font.label,
                fontSize: T.size.eyebrow,
                lineHeight: T.size.eyebrowLine,
                letterSpacing: T.tracking.eyebrow,
                textTransform: "uppercase",
                color: T.color.inkTextSecondary,
              }}
            >
              {eyebrow}
            </Text>
          </Column>
        </Row>
      ) : null}
    </Section>
  );
}
