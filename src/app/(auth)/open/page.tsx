"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { HandlerShell } from "../auth/action/HandlerShell";

function OpenInner() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "";
  const label =
    from === "password-reset"
      ? "Password set."
      : from === "email-verified"
      ? "Email verified."
      : from === "email-recovered"
      ? "Email reverted."
      : "You're good.";
  return (
    <HandlerShell eyebrow="Open OPS">
      <h1
        className="font-mohave text-text-primary mb-2"
        style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
      >
        {label}
      </h1>
      <p
        className="font-mohave text-text-secondary mb-6"
        style={{ fontSize: "15px", lineHeight: "22px" }}
      >
        Tap below to jump into the OPS app. If you don&apos;t have it yet,
        grab it from the App Store.
      </p>
      <a
        href={`https://app.opsapp.co/open?from=${encodeURIComponent(from)}`}
        className="block w-full text-center rounded-sm font-kosugi uppercase"
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
        Open OPS →
      </a>
      <a
        href="https://apps.apple.com/ca/app/ops-for-trades/id6746662078"
        className="block w-full text-center rounded-sm font-kosugi uppercase mt-3"
        style={{
          minHeight: "60px",
          background: "transparent",
          color: "#E5E5E5",
          fontSize: "13px",
          letterSpacing: "1.8px",
          lineHeight: "60px",
          border: "1px solid rgba(255,255,255,0.2)",
          textDecoration: "none",
        }}
      >
        App Store →
      </a>
      <a
        href="/login"
        className="block text-center mt-3 font-kosugi uppercase text-text-tertiary hover:text-text-secondary transition-colors"
        style={{ fontSize: "11px", letterSpacing: "1.2px" }}
      >
        Sign in on web
      </a>
    </HandlerShell>
  );
}

export default function OpenPage() {
  return (
    <React.Suspense
      fallback={
        <HandlerShell eyebrow="Loading">
          <p
            className="font-kosugi uppercase text-text-tertiary"
            style={{ fontSize: "10px", letterSpacing: "1.2px" }}
          >
            • • •
          </p>
        </HandlerShell>
      }
    >
      <OpenInner />
    </React.Suspense>
  );
}

export const metadata = {
  other: {
    "apple-itunes-app":
      "app-id=6746662078, app-argument=https://app.opsapp.co/open",
  },
};
