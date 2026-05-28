import * as React from "react";
import { Html, Head, Body, Container, Text } from "@react-email/components";
import { FounderFooter } from "./FounderFooter";

/**
 * Layout primitive for the onboarding drip's founder-voice emails
 * (Day 0, Day 3, Day 8, Day 14 quiet/active, LostYou). Renders the
 * body content as a single white container — NO glass card, NO logo,
 * NO branded chrome. The whole point is that the email looks like a
 * real personal email Jack typed, not a templated send.
 *
 * Children should be plain text (or simple <Text> blocks). Newlines
 * are preserved via white-space: pre-wrap.
 *
 * @template-version 1.0.0
 */
export function PlainTextLayout({
  children,
  unsubscribeUrl,
}: {
  children: React.ReactNode;
  unsubscribeUrl: string;
}) {
  return (
    <Html>
      <Head />
      <Body
        style={{
          backgroundColor: "#ffffff",
          fontFamily: "Helvetica, Arial, sans-serif",
          color: "#1a1a1a",
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            padding: "32px 24px",
          }}
        >
          <Text
            style={{
              fontSize: "15px",
              lineHeight: "22px",
              color: "#1a1a1a",
              margin: 0,
              whiteSpace: "pre-wrap",
            }}
          >
            {children}
          </Text>
          <FounderFooter unsubscribeUrl={unsubscribeUrl} />
        </Container>
      </Body>
    </Html>
  );
}

export const previewProps = {
  unsubscribeUrl: "https://app.opsapp.co/api/email/unsubscribe?t=preview",
  children: "Hey there Jackson,\n\nThis is a preview of the layout.\n\n— Jack",
};
