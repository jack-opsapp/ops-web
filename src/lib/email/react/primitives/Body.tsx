import * as React from "react";
import { Section } from "@react-email/components";
import { emailTokens as T } from "./tokens";

interface BodyBandProps {
  children: React.ReactNode;
}

export function BodyBand({ children }: BodyBandProps) {
  return (
    <Section
      style={{
        background: T.color.paper,
        padding: `${T.layout.bandPaddingY} ${T.layout.bandPaddingX}`,
      }}
    >
      {children}
    </Section>
  );
}
