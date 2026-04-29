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

interface PortalEmailLayoutProps {
  preview: string;
  eyebrow?: string;
  companyName: string;
  /**
   * Customer-provided postal address shown in the compliance footer for
   * whitelabel portal emails. CAN-SPAM/CASL require the company's address
   * (not OPS's) since the email is sent on the company's behalf. If NULL or
   * blank, ComplianceFooter falls back to the OPS address — the operator
   * runbook nudges the company to fill this in via Settings → Company.
   */
  companyPhysicalAddress?: string | null;
  logoUrl?: string | null;
  accentColor: string;
  senderAddress: string;
  /** @deprecated retained for prop-compat with PR β templates; unused. */
  mode?: "transactional" | "marketing";
  unsubscribeUrl?: string;
  list?: string;
  children: React.ReactNode;
}

export function PortalEmailLayout({
  preview,
  eyebrow,
  companyName,
  companyPhysicalAddress,
  logoUrl,
  accentColor,
  senderAddress,
  unsubscribeUrl,
  list,
  children,
}: PortalEmailLayoutProps) {
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
          <Hero
            variant="portal"
            eyebrow={eyebrow}
            companyName={companyName}
            logoUrl={logoUrl}
            accentColor={accentColor}
          />
          <BodyBand>{children}</BodyBand>
          <ComplianceFooter
            list={list ?? "global"}
            unsubscribeUrl={unsubscribeUrl}
            physicalAddress={companyPhysicalAddress ?? undefined}
            legalName={companyName}
          />
          <Footer
            variant="portal"
            senderAddress={senderAddress}
            companyName={companyName}
          />
        </Container>
      </Body>
    </Html>
  );
}
