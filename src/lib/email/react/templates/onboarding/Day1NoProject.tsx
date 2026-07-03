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

/**
 * Day 1 Branch A — fires when the operator has NOT completed web
 * onboarding OR has zero projects. Sent from OPS Dispatch.
 * Body copy is canonical per spec §6.
 *
 * @template-version 1.0.0
 */
export interface Day1NoProjectProps {
  ctaUrl: string;
  unsubscribeUrl: string;
}

export function Day1NoProject({ ctaUrl, unsubscribeUrl }: Day1NoProjectProps) {
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
              Day 1. You signed up yesterday.
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 16px 0" }}>
              The move that puts the rest of the system to work: drop your first project in. Real client, real address, real tasks.
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 16px 0" }}>
              Without a project, OPS has nothing to work from. Once a project&apos;s in, the schedule, the crew, the photos, the estimates, the invoices all hang off it.
            </Text>
            <Text style={{ fontSize: "15px", lineHeight: "22px", margin: "0 0 24px 0" }}>
              Use a job you&apos;re actually running this week. Takes two minutes.
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
                DROP YOUR FIRST PROJECT
              </Button>
            </Section>
          </Section>
          <FounderFooter unsubscribeUrl={unsubscribeUrl} />
        </Container>
      </Body>
    </Html>
  );
}

export const previewProps: Day1NoProjectProps = {
  // /projects/new is the permanent create deep link (opens the workspace
  // create window on the dashboard) — emails in customer inboxes link here.
  ctaUrl: "https://app.opsapp.co/projects/new",
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
};
