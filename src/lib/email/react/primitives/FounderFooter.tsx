import * as React from "react";
import { Text, Link, Section } from "@react-email/components";

/**
 * Minimal single-line compliance footer used by founder plain-text emails
 * (Day 0, Day 3, Day 8, Day 14, LostYou) in the onboarding drip.
 * Renders in small grey type so it's legally compliant without breaking
 * the personal-email feel.
 *
 * @template-version 1.0.0
 */
export function FounderFooter({ unsubscribeUrl }: { unsubscribeUrl: string }) {
  return (
    <Section
      style={{
        marginTop: "32px",
        paddingTop: "16px",
        borderTop: "1px solid #e5e5e5",
      }}
    >
      <Text
        style={{
          fontSize: "11px",
          color: "#8A8A8A",
          fontFamily: "Helvetica, Arial, sans-serif",
          margin: 0,
          lineHeight: "16px",
        }}
      >
        OPS LTD. · 1515 Douglas St, Victoria, BC V8W 2G4 ·{" "}
        <Link
          href={unsubscribeUrl}
          style={{ color: "#8A8A8A", textDecoration: "underline" }}
        >
          Unsubscribe
        </Link>
      </Text>
    </Section>
  );
}

export const previewProps = {
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
};
