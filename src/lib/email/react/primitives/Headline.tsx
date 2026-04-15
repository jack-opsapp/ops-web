import * as React from "react";
import { Heading } from "@react-email/components";
import { emailTokens as T } from "./tokens";

interface HeadlineProps {
  children: React.ReactNode;
  as?: "h1" | "h2";
}

export function Headline({ children, as = "h1" }: HeadlineProps) {
  const isH1 = as === "h1";
  return (
    <Heading
      as={as}
      style={{
        margin: `0 0 ${T.spacing.sm} 0`,
        fontFamily: T.font.sans,
        fontSize: isH1 ? T.size.h1 : T.size.h2,
        lineHeight: isH1 ? T.size.h1Line : T.size.h2Line,
        fontWeight: isH1 ? T.weight.semibold : T.weight.medium,
        color: T.color.ink,
        letterSpacing: T.tracking.tight,
      }}
    >
      {children}
    </Heading>
  );
}
