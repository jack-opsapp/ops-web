import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Preview,
  Font,
} from "@react-email/components";
import { Hero, BodyBand, Footer, emailTokens as T } from "../primitives";

const OPS_PHYSICAL_ADDRESS =
  "OPS Ltd. · 1515 Douglas St, Victoria, BC V8W 2G4, Canada";

interface PortalEmailLayoutProps {
  preview: string;
  eyebrow?: string;
  companyName: string;
  logoUrl?: string | null;
  accentColor: string;
  senderAddress: string;
  mode?: "transactional" | "marketing";
  unsubscribeUrl?: string;
  children: React.ReactNode;
}

export function PortalEmailLayout({
  preview,
  eyebrow,
  companyName,
  logoUrl,
  accentColor,
  senderAddress,
  mode = "transactional",
  unsubscribeUrl,
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
          fontFamily="Kosugi"
          fallbackFontFamily="Helvetica"
          webFont={{
            url: "https://fonts.googleapis.com/css2?family=Kosugi&display=swap",
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
          <Footer
            variant="portal"
            mode={mode}
            senderAddress={senderAddress}
            unsubscribeUrl={unsubscribeUrl}
            companyName={companyName}
            physicalAddress={OPS_PHYSICAL_ADDRESS}
          />
        </Container>
      </Body>
    </Html>
  );
}
