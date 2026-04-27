import * as React from "react";
import { Section, Text, Link, Hr } from "@react-email/components";
import { emailTokens as T } from "./tokens";
import {
  OPS_LEGAL_NAME,
  OPS_PHYSICAL_ADDRESS,
  OPS_SUPPORT_EMAIL,
  LIST_DISPLAY_NAMES,
} from "../../constants";

/**
 * CAN-SPAM (15 USC 7704) + CASL (S.C. 2010, c. 23) compliance footer.
 *
 * Rendered in every OPS email regardless of transactional vs marketing
 * classification — both regimes require a physical address and a working
 * unsubscribe path on every commercial communication. The unsubscribe URL
 * is always shown; transactional kinds map to the `global` list, so
 * unsubscribing kills everything (which is what the recipient is asking for).
 */
export interface ComplianceFooterProps {
  list: string;
  unsubscribeUrl?: string;
  /**
   * Override for whitelabel portal emails — the *customer's* physical address.
   * If omitted, falls back to OPS_PHYSICAL_ADDRESS so the footer always
   * carries a postal address (CAN-SPAM minimum).
   */
  physicalAddress?: string;
  /**
   * Override for the legal entity name shown in the eyebrow. Defaults to
   * OPS_LEGAL_NAME; portal layout passes the customer's company name.
   */
  legalName?: string;
}

export function ComplianceFooter({
  list,
  unsubscribeUrl,
  physicalAddress,
  legalName,
}: ComplianceFooterProps) {
  const listDisplay = LIST_DISPLAY_NAMES[list] ?? LIST_DISPLAY_NAMES.global;
  const addressLine = physicalAddress?.trim() ? physicalAddress : OPS_PHYSICAL_ADDRESS;
  const nameLine = legalName?.trim() ? legalName : OPS_LEGAL_NAME;

  return (
    <Section
      style={{
        background: T.color.ink,
        padding: `0 ${T.layout.bandPaddingX} ${T.spacing.lg}`,
      }}
    >
      <Hr
        style={{
          borderColor: T.color.inkRule,
          borderTop: "none",
          borderBottom: `1px solid ${T.color.inkRule}`,
          margin: `0 0 ${T.spacing.md} 0`,
        }}
      />
      <Text
        style={{
          margin: `0 0 ${T.spacing.xs} 0`,
          fontFamily: T.font.label,
          fontSize: T.size.eyebrow,
          lineHeight: T.size.eyebrowLine,
          letterSpacing: T.tracking.eyebrow,
          textTransform: "uppercase",
          color: T.color.inkTextMeta,
        }}
      >
        {"// "}{nameLine}
      </Text>
      <Text
        style={{
          margin: `0 0 ${T.spacing.sm} 0`,
          fontFamily: T.font.sans,
          fontSize: T.size.footerBody,
          lineHeight: T.size.footerBodyLine,
          color: T.color.inkTextSecondary,
        }}
      >
        {addressLine}
      </Text>
      <Text
        style={{
          margin: 0,
          fontFamily: T.font.sans,
          fontSize: T.size.footerBody,
          lineHeight: T.size.footerBodyLine,
          color: T.color.inkTextMeta,
        }}
      >
        You&apos;re receiving this because you subscribed to {listDisplay}.{" "}
        {unsubscribeUrl ? (
          <>
            <Link
              href={unsubscribeUrl}
              style={{
                color: T.color.inkTextSecondary,
                textDecoration: "underline",
              }}
            >
              Unsubscribe
            </Link>
            {" or "}
          </>
        ) : null}
        write us at{" "}
        <Link
          href={`mailto:${OPS_SUPPORT_EMAIL}`}
          style={{
            color: T.color.inkTextSecondary,
            textDecoration: "underline",
          }}
        >
          {OPS_SUPPORT_EMAIL}
        </Link>
        .
      </Text>
    </Section>
  );
}
