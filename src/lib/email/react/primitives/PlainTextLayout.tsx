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
 * Splits the body on \n\n into separate <Text> blocks so each
 * paragraph renders as a distinct block in both HTML and plain-text
 * outputs. (A single <Text> wrapper collapses to one paragraph in
 * plain-text mode, which then word-wraps at 80 cols and can split
 * load-bearing phrases — see commit fixing PlainTextLayout 1.0.0.)
 *
 * Children should be a single string of paragraphs separated by \n\n,
 * OR a sequence of React children that flatten to such a string.
 * Templates compose like:
 *   <>{greeting}{"\n\n"}Body line one.{"\n\n"}Body line two.</>
 * which flattens to: ["Hey there Pat,", "\n\n", "Body line one.", ...].
 * Non-string children are skipped during normalization.
 *
 * @template-version 1.1.0
 */
export function PlainTextLayout({
  children,
  unsubscribeUrl,
}: {
  children: React.ReactNode;
  unsubscribeUrl: string;
}) {
  const text = React.Children.toArray(children)
    .map((child) => (typeof child === "string" ? child : ""))
    .join("");
  const paragraphs = text.split(/\n\n+/).filter((p) => p.length > 0);

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
          {paragraphs.map((paragraph, i) => (
            <Text
              key={i}
              style={{
                fontSize: "15px",
                lineHeight: "22px",
                color: "#1a1a1a",
                margin: i === 0 ? "0 0 16px 0" : "16px 0",
                whiteSpace: "pre-wrap",
              }}
            >
              {paragraph}
            </Text>
          ))}
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
