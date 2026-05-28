// @template-version: 1.0.0
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
import { MockPushNotification } from "@/lib/email/react/primitives/MockPushNotification";

/**
 * Day 4 Branch A — fires when the operator has NOT received a
 * task_completed notification yet. Sent from OPS Dispatch.
 * Body copy is canonical per spec §6. Load-bearing visual element:
 * the MockPushNotification card showing the future-state moment.
 *
 * @template-version 1.0.0
 */
export interface Day4NoNotificationProps {
  ctaUrl: string;
  unsubscribeUrl: string;
}

export function Day4NoNotification({
  ctaUrl,
  unsubscribeUrl,
}: Day4NoNotificationProps) {
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
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 8px 0" }}>
              Day 4.
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 16px 0" }}>
              Here's the moment you're working toward:
            </Text>
            <MockPushNotification
              completedByName="Jake"
              taskTitle="Rail Install"
              projectTitle="5611 Batu Rd"
            />
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "16px 0" }}>
              That notification lands on your phone the first time someone on your crew taps DONE in the field. From a job you weren't on. On a task you didn't have to chase.
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 8px 0" }}>
              To get there:
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 4px 0" }}>
              &nbsp;&nbsp;1. Invite at least one crew member
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 4px 0" }}>
              &nbsp;&nbsp;2. Get them logged into the OPS mobile app
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 24px 0" }}>
              &nbsp;&nbsp;3. Assign them a task
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
                INVITE YOUR CREW
              </Button>
            </Section>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "16px 0 0 0" }}>
              The first time you hear that ping while you're somewhere else, you'll know why we built this.
            </Text>
          </Section>
          <FounderFooter unsubscribeUrl={unsubscribeUrl} />
        </Container>
      </Body>
    </Html>
  );
}

export const previewProps: Day4NoNotificationProps = {
  ctaUrl: "https://app.opsapp.co/settings/team",
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
};
