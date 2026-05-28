import * as React from "react";
import {
  Html, Head, Body, Container, Section, Text, Button,
} from "@react-email/components";
import { FounderFooter } from "@/lib/email/react/primitives/FounderFooter";

/**
 * Day 4 Branch B — fires when the operator has already received a
 * task_completed notification. Sent from OPS Dispatch. Pivots to
 * compounding moves (recurring jobs, more crew, templates).
 * Body copy is canonical per spec §6.
 *
 * @template-version 1.0.0
 */
export interface Day4HasNotificationProps {
  ctaUrl: string;
  unsubscribeUrl: string;
}

export function Day4HasNotification({
  ctaUrl,
  unsubscribeUrl,
}: Day4HasNotificationProps) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: "#000000", color: "#EDEDED", fontFamily: "Helvetica, Arial, sans-serif", margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "32px 24px" }}>
          <Section>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 16px 0" }}>
              Day 4. At least one crew member has tapped DONE in the field and you've seen the notification land.
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 16px 0" }}>
              Most operators are surprised by how good that feels — the quiet of not having to chase.
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 8px 0" }}>
              The moves that compound it:
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 4px 0" }}>
              &nbsp;&nbsp;→ Recurring jobs for the work you do every week
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 4px 0" }}>
              &nbsp;&nbsp;→ Adding more crew, so the same setup covers more work
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 24px 0" }}>
              &nbsp;&nbsp;→ Templates so you don't rebuild the same tasks every time
            </Text>
            <Section style={{ textAlign: "left", margin: "24px 0" }}>
              <Button
                href={ctaUrl}
                style={{
                  backgroundColor: "transparent",
                  color: "#6F94B0",
                  border: "1px solid #6F94B0",
                  padding: "12px 20px",
                  borderRadius: "5px",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "13px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  textDecoration: "none",
                }}
              >
                SET UP RECURRING JOBS
              </Button>
            </Section>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "16px 0 0 0" }}>
              You're past the first hill. The next 26 days is about putting the rest of your business in.
            </Text>
          </Section>
          <FounderFooter unsubscribeUrl={unsubscribeUrl} />
        </Container>
      </Body>
    </Html>
  );
}

export const previewProps: Day4HasNotificationProps = {
  ctaUrl: "https://app.opsapp.co/projects?filter=recurring",
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
};
