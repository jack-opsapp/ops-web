"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { HandlerShell } from "../auth/action/HandlerShell";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

const REASONS = {
  "password-reset": {
    headline: "Password reset.",
    body: "Open OPS to sign in.",
  },
  "email-verified": {
    headline: "Email verified.",
    body: "Open OPS to continue.",
  },
  "email-recovered": {
    headline: "Email reverted.",
    body: "Open OPS to sign in.",
  },
  "magic-link": {
    headline: "Signed in.",
    body: "Open OPS to continue.",
  },
} as const;

const DEFAULT_COPY = {
  headline: "OPS is ready.",
  body: "Open OPS to continue.",
} as const;

function copyFor(reason: string) {
  return REASONS[reason as keyof typeof REASONS] ?? DEFAULT_COPY;
}

function OpenInner() {
  const reduced = useReducedMotion();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "";
  const c = copyFor(from);

  const t = (delay = 0) =>
    reduced ? { duration: 0 } : { duration: 0.4, ease: EASE_SMOOTH, delay };

  return (
    <HandlerShell eyebrow="Open OPS">
      <motion.h1
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t()}
        className="font-mohave text-text-primary mb-2"
        style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
      >
        {c.headline}
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t(0.05)}
        className="font-mohave text-text-2 mb-6"
        style={{ fontSize: "15px", lineHeight: "22px" }}
      >
        {c.body}
      </motion.p>
      <motion.a
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t(0.1)}
        href="opsapp://"
        className="flex items-center justify-start w-full rounded font-cakemono font-light uppercase text-ops-accent border border-ops-accent transition-colors duration-200 hover:bg-ops-accent hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black px-4"
        style={{
          minHeight: "60px",
          fontSize: "13px",
          letterSpacing: "0.16em",
          textDecoration: "none",
        }}
      >
        Open OPS →
      </motion.a>
      <motion.a
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t(0.16)}
        href="https://apps.apple.com/app/id6746662078"
        className="flex items-center justify-start w-full rounded font-cakemono font-light uppercase text-text-2 border border-border transition-colors duration-200 hover:text-text-primary hover:border-border-medium mt-3 px-4"
        style={{
          minHeight: "60px",
          fontSize: "13px",
          letterSpacing: "0.16em",
          textDecoration: "none",
        }}
      >
        App Store →
      </motion.a>
      <motion.a
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={t(0.22)}
        href="/login"
        className="block mt-3 font-mono uppercase text-text-3 hover:text-text-2 transition-colors"
        style={{ fontSize: "11px", letterSpacing: "0.12em" }}
      >
        [sign in on web]
      </motion.a>
    </HandlerShell>
  );
}

export default function OpenPage() {
  return (
    <React.Suspense
      fallback={
        <HandlerShell eyebrow="Loading">
          <p
            className="font-mono uppercase text-text-3"
            style={{ fontSize: "10px", letterSpacing: "0.12em" }}
          >
            [working...]
          </p>
        </HandlerShell>
      }
    >
      <OpenInner />
    </React.Suspense>
  );
}
