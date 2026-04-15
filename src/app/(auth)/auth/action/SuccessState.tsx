"use client";

import * as React from "react";
import { useUserAgent } from "./useUserAgent";
import { handlerCopy } from "./copy";

interface SuccessStateProps {
  chip: string;
  headline: string;
  subline: React.ReactNode;
  from: string;
  extraCta?: { label: string; href: string };
}

export function SuccessState({
  chip,
  headline,
  subline,
  from,
  extraCta,
}: SuccessStateProps) {
  const device = useUserAgent();
  const iosOpen = `https://app.opsapp.co/open?from=${encodeURIComponent(from)}`;
  const primaryHref = device === "ios" ? iosOpen : "/login";
  const primaryLabel =
    device === "ios"
      ? handlerCopy.success.iosPrimaryCta
      : handlerCopy.success.webPrimaryCta;
  return (
    <div>
      <div
        className="inline-flex items-center gap-2 px-2 py-1 rounded-sm font-kosugi uppercase mb-4"
        style={{
          background: "rgba(165, 179, 104, 0.15)",
          color: "#A5B368",
          border: "1px solid rgba(165, 179, 104, 0.3)",
          fontSize: "11px",
          letterSpacing: "1.2px",
        }}
      >
        ✓&nbsp;{chip}
      </div>
      <h1
        className="font-mohave text-text-primary mb-2"
        style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
      >
        {headline}
      </h1>
      <p
        className="font-mohave text-text-secondary mb-6"
        style={{ fontSize: "15px", lineHeight: "22px" }}
      >
        {subline}
      </p>
      <a
        href={primaryHref}
        className="block w-full text-center rounded-sm font-kosugi uppercase transition-opacity"
        style={{
          minHeight: "60px",
          background: "#597794",
          color: "#FFFFFF",
          fontSize: "13px",
          letterSpacing: "1.8px",
          lineHeight: "60px",
          border: "1px solid #597794",
          textDecoration: "none",
        }}
      >
        {primaryLabel} →
      </a>
      {device === "ios" ? (
        <a
          href="/login"
          className="block text-center mt-3 font-kosugi uppercase text-text-tertiary hover:text-text-secondary transition-colors"
          style={{ fontSize: "11px", letterSpacing: "1.2px" }}
        >
          {handlerCopy.success.webSecondaryCta}
        </a>
      ) : null}
      {extraCta ? (
        <a
          href={extraCta.href}
          className="block text-center mt-3 font-kosugi uppercase text-text-tertiary hover:text-text-secondary transition-colors"
          style={{ fontSize: "11px", letterSpacing: "1.2px" }}
        >
          {extraCta.label}
        </a>
      ) : null}
    </div>
  );
}
