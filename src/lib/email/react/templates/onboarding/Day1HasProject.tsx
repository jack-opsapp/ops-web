import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Button,
} from "@react-email/components";
import { FounderFooter } from "@/lib/email/react/primitives/FounderFooter";

/**
 * Day 1 Branch B — fires when the operator has completed web onboarding
 * AND has at least one project. Sent from OPS Dispatch. Body copy is
 * canonical per spec §6.
 *
 * @template-version 1.0.0
 */
export interface Day1HasProjectProps {
  projectCount: number;
  ctaUrl: string;
  unsubscribeUrl: string;
}

export function Day1HasProject({
  projectCount,
  ctaUrl,
  unsubscribeUrl,
}: Day1HasProjectProps) {
  const countLine =
    projectCount === 1
      ? "You've already got your first project in."
      : `You've got ${projectCount} projects in.`;
  return (
    <Html>
      <Head />
      <Body
        style={{
          backgroundColor: "#000000",
          color: "#EDEDED",
          fontFamily: "Helvetica, Arial, sans-serif",
          margin: 0,
          padding: 0,
        }}
      >
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "32px 24px" }}>
          <Section>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 16px 0" }}>
              Day 1. {countLine}
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 16px 0" }}>
              That's the spine. The next move puts OPS to work for you: tasks on those projects, and at least one crew member with the mobile app installed.
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 24px 0" }}>
              When a team member taps DONE in the field, a notification lands on your phone. From a job you weren't on. On a task you didn't have to chase.
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
                ASSIGN A TASK + INVITE A CREW MEMBER
              </Button>
            </Section>
          </Section>
          <FounderFooter unsubscribeUrl={unsubscribeUrl} />
        </Container>
      </Body>
    </Html>
  );
}

export const previewProps: Day1HasProjectProps = {
  projectCount: 2,
  ctaUrl: "https://app.opsapp.co/dashboard",
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
};
