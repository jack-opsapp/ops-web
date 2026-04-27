import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Preview,
  Font,
} from "@react-email/components";
import {
  Hero,
  BodyBand,
  Footer,
  ComplianceFooter,
  emailTokens as T,
} from "../primitives";

interface OpsEmailLayoutProps {
  preview: string;
  eyebrow?: string;
  senderAddress: string;
  /** @deprecated retained for prop-compat with PR β templates; unused. */
  mode?: "transactional" | "marketing";
  /**
   * `List-Unsubscribe` value used both in the rendered footer link and
   * (separately) in the SMTP headers injected by `gatedSend`.
   */
  unsubscribeUrl?: string;
  /**
   * `List-Unsubscribe` list value (e.g. `global`, `field_notes`, `blog`).
   * Used in the compliance footer's "you subscribed to {LIST}" sentence.
   * Defaults to `global`.
   */
  list?: string;
  children: React.ReactNode;
}

export function OpsEmailLayout({
  preview,
  eyebrow,
  senderAddress,
  unsubscribeUrl,
  list,
  children,
}: OpsEmailLayoutProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <Font
          fontFamily="Mohave"
          fallbackFontFamily="Helvetica"
          webFont={{
            url: "https://fonts.googleapis.com/css2?family=Mohave:wght@400;500;600;700&display=swap",
            format: "woff2",
          }}
          fontWeight={400}
          fontStyle="normal"
        />
        <Font
          fontFamily="JetBrains Mono"
          fallbackFontFamily="monospace"
          webFont={{
            url: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap",
            format: "woff2",
          }}
          fontWeight={400}
          fontStyle="normal"
        />
      </Head>
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          padding: 0,
          background: T.color.ink,
          fontFamily: T.font.sans,
        }}
      >
        <Container
          style={{
            width: "100%",
            maxWidth: T.layout.containerWidth,
            margin: "0 auto",
            padding: 0,
          }}
        >
          <Hero variant="ops" eyebrow={eyebrow} />
          <BodyBand>{children}</BodyBand>
          <ComplianceFooter list={list ?? "global"} unsubscribeUrl={unsubscribeUrl} />
          <Footer variant="ops" senderAddress={senderAddress} />
        </Container>
      </Body>
    </Html>
  );
}
