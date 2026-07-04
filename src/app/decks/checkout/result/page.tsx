"use client";

/**
 * Stripe checkout return surface for the standalone OPS Decks app.
 *
 * buildDecksetCheckoutReturnUrls (src/lib/decks/billing/stripe-deckset.ts)
 * sends the purchaser here with ?status=success|cancelled after Stripe
 * checkout. Deliberately auth-free — the purchaser may have no OPS web login;
 * the entitlement itself lands in deck_subscriptions via the Stripe webhook
 * and unlocks in the app on the next foreground refresh, so this page only
 * confirms the outcome and points the operator back to the app.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";

const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

type Outcome = "success" | "cancelled";

interface OutcomeCopy {
  tone: "olive" | "tan";
  label: string;
  heading: string;
  body: string;
}

const OUTCOMES: Record<Outcome, OutcomeCopy> = {
  success: {
    tone: "olive",
    label: "// PAYMENT CONFIRMED",
    heading: "PRO UNLOCKED",
    body: "Payment confirmed. Return to OPS Decks — Pro unlocks the moment the app is back in front of you.",
  },
  cancelled: {
    tone: "tan",
    label: "// CHECKOUT CANCELLED",
    heading: "NOTHING CHARGED",
    body: "No charge went through. Return to OPS Decks whenever you're ready to go Pro.",
  },
};

function resolveOutcome(status: string | null): Outcome {
  return status === "success" ? "success" : "cancelled";
}

function OpsMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 2400 2400"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M1624.48,1228.51v-563.59s-375.6-187.86-375.6-187.86h0l-281.73,140.87.16.08,469.34,234.72v469.62s.07.04.07.04l187.78-93.89Z" />
      <path d="M1432.95,1775.53l.03-.02v-.08l-469.49-234.8-.13-469.56-187.37,93.85-.15.08-.33,563.39.15.08,375.54,187.82.1.06,281.64-140.81Z" />
    </svg>
  );
}

function CheckoutResultInner() {
  const params = useSearchParams();
  const reduced = useReducedMotion();
  const outcome = resolveOutcome(params.get("status"));
  const copy = OUTCOMES[outcome];

  const toneText = copy.tone === "olive" ? "text-olive" : "text-tan";

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4 py-16">
      <motion.section
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_SMOOTH }}
        className="glass-surface w-full max-w-[420px] px-8 py-10 flex flex-col items-center text-center"
      >
        <OpsMark className="h-8 w-8 text-text-3" />

        <p
          className={`mt-8 font-mono text-[11px] uppercase tracking-[0.16em] ${toneText}`}
        >
          {copy.label}
        </p>

        <h1 className="mt-3 font-cakemono font-light text-cake-display uppercase tracking-tight text-text">
          {copy.heading}
        </h1>

        <p className="mt-4 font-mohave text-[14px] leading-relaxed text-text-secondary">
          {copy.body}
        </p>

        <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          SYS :: OPS DECKS
        </p>
      </motion.section>
    </main>
  );
}

export default function CheckoutResultPage() {
  return (
    <React.Suspense
      fallback={<div className="min-h-screen bg-background" />}
    >
      <CheckoutResultInner />
    </React.Suspense>
  );
}
