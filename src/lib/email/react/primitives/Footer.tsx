import * as React from "react";
import { Section, Row, Column, Text, Link } from "@react-email/components";
import { emailTokens as T } from "./tokens";

interface FooterProps {
  variant: "ops" | "portal";
  mode: "transactional" | "marketing";
  senderAddress: string;
  /** Required for marketing mode */
  unsubscribeUrl?: string;
  /** Portal variant only */
  companyName?: string;
  /** CAN-SPAM / CASL physical address — required */
  physicalAddress: string;
}

export function Footer({
  variant,
  mode,
  senderAddress,
  unsubscribeUrl,
  companyName,
  physicalAddress,
}: FooterProps) {
  return (
    <Section
      style={{
        background: T.color.ink,
        padding: `${T.spacing.lg} ${T.layout.bandPaddingX}`,
      }}
    >
      <Row>
        <Column>
          {variant === "ops" ? (
            <Text
              style={{
                margin: `0 0 ${T.spacing.xs} 0`,
                fontFamily: T.font.sans,
                fontSize: T.size.footerBody,
                lineHeight: T.size.footerBodyLine,
                color: T.color.inkTextPrimary,
              }}
            >
              OPS Ltd. — Built by trades, for trades.
              <br />
              <Link
                href="https://app.opsapp.co"
                style={{ color: T.color.inkTextPrimary, textDecoration: "none" }}
              >
                app.opsapp.co
              </Link>
            </Text>
          ) : (
            <Text
              style={{
                margin: `0 0 ${T.spacing.xs} 0`,
                fontFamily: T.font.sans,
                fontSize: T.size.footerBody,
                lineHeight: T.size.footerBodyLine,
                color: T.color.inkTextPrimary,
              }}
            >
              Sent by {companyName} via OPS.
              <br />
              <Link
                href="https://app.opsapp.co"
                style={{ color: T.color.inkTextPrimary, textDecoration: "none" }}
              >
                opsapp.co
              </Link>
            </Text>
          )}
          <Text
            style={{
              margin: `${T.spacing.xs} 0`,
              fontFamily: T.font.label,
              fontSize: T.size.meta,
              lineHeight: T.size.metaLine,
              letterSpacing: T.tracking.meta,
              textTransform: "uppercase",
              color: T.color.inkTextMeta,
            }}
          >
            Sent from {senderAddress}
          </Text>
          <Text
            style={{
              margin: `${T.spacing.sm} 0 0 0`,
              fontFamily: T.font.sans,
              fontSize: T.size.meta,
              lineHeight: T.size.metaLine,
              color: T.color.inkTextMeta,
            }}
          >
            {physicalAddress}
          </Text>
          {mode === "marketing" && unsubscribeUrl ? (
            <Text
              style={{
                margin: `${T.spacing.sm} 0 0 0`,
                fontFamily: T.font.label,
                fontSize: T.size.meta,
                lineHeight: T.size.metaLine,
                letterSpacing: T.tracking.meta,
                textTransform: "uppercase",
                color: T.color.inkTextMeta,
              }}
            >
              <Link
                href={unsubscribeUrl}
                style={{ color: T.color.inkTextMeta, textDecoration: "underline" }}
              >
                Unsubscribe
              </Link>
            </Text>
          ) : null}
        </Column>
      </Row>
    </Section>
  );
}
