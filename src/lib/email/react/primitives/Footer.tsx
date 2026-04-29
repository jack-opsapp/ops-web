import * as React from "react";
import { Section, Row, Column, Text, Link } from "@react-email/components";
import { emailTokens as T } from "./tokens";

/**
 * Brand footer block — renders the OPS or portal sign-off line and the
 * SendGrid sender address. The CAN-SPAM physical address and unsubscribe
 * link live in `ComplianceFooter`, which is rendered separately below the
 * brand band so each block has a single responsibility.
 */
interface FooterProps {
  variant: "ops" | "portal";
  senderAddress: string;
  /** Portal variant only */
  companyName?: string;
}

export function Footer({ variant, senderAddress, companyName }: FooterProps) {
  return (
    <Section
      style={{
        background: T.color.ink,
        padding: `${T.spacing.sm} ${T.layout.bandPaddingX} ${T.spacing.lg}`,
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
              margin: `${T.spacing.xs} 0 0 0`,
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
        </Column>
      </Row>
    </Section>
  );
}
