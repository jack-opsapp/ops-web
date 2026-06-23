"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useUserAgent } from "./useUserAgent";
import { handlerCopy } from "./copy";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

interface SuccessStateProps {
  chip: string;
  headline: string;
  subline: React.ReactNode;
  from: string;
  extraCta?:
    | { label: string; href: string }
    | { label: string; onClick: () => void };
}

export function SuccessState({
  chip,
  headline,
  subline,
  from,
  extraCta,
}: SuccessStateProps) {
  const device = useUserAgent();
  const reduced = useReducedMotion();
  const t = (delay = 0) =>
    reduced
      ? { duration: 0 }
      : { duration: 0.4, ease: EASE_SMOOTH, delay };

  const iosOpen = `/open?from=${encodeURIComponent(from)}`;
  const primaryHref = device === "ios" ? iosOpen : "/login";
  const primaryLabel =
    device === "ios"
      ? handlerCopy.success.iosPrimaryCta
      : handlerCopy.success.webPrimaryCta;

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={t()}
        className="inline-flex items-center gap-2 px-2 py-1 rounded-chip font-cakemono font-light uppercase mb-4"
        style={{
          color: "#9DB582",
          border: "1px solid #9DB582",
          background: "transparent",
          fontSize: "11px",
          letterSpacing: "0.18em",
        }}
      >
        {"// "}{chip}
      </motion.div>
      <motion.h1
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t(0.05)}
        className="font-mohave text-text-primary mb-2"
        style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
      >
        {headline}
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t(0.1)}
        className="font-mohave text-text-2 mb-6"
        style={{ fontSize: "15px", lineHeight: "22px" }}
      >
        {subline}
      </motion.p>
      <motion.a
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={t(0.15)}
        href={primaryHref}
        className="flex items-center justify-start w-full rounded font-cakemono font-light uppercase text-ops-accent border border-ops-accent transition-colors duration-200 hover:bg-ops-accent hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black px-4"
        style={{
          minHeight: "60px",
          fontSize: "13px",
          letterSpacing: "0.16em",
          textDecoration: "none",
        }}
      >
        {primaryLabel} →
      </motion.a>
      {device === "ios" ? (
        <motion.a
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={t(0.22)}
          href="/login"
          className="block mt-3 font-mono uppercase text-text-3 hover:text-text-2 transition-colors"
          style={{ fontSize: "11px", letterSpacing: "0.12em" }}
        >
          [{handlerCopy.success.webSecondaryCta}]
        </motion.a>
      ) : null}
      {extraCta ? (
        "onClick" in extraCta ? (
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={t(0.28)}
            onClick={extraCta.onClick}
            className="block w-full text-left mt-3 font-mono uppercase text-text-3 hover:text-text-2 transition-colors"
            style={{ fontSize: "11px", letterSpacing: "0.12em" }}
          >
            [{extraCta.label}]
          </motion.button>
        ) : (
          <motion.a
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={t(0.28)}
            href={extraCta.href}
            className="block mt-3 font-mono uppercase text-text-3 hover:text-text-2 transition-colors"
            style={{ fontSize: "11px", letterSpacing: "0.12em" }}
          >
            [{extraCta.label}]
          </motion.a>
        )
      ) : null}
    </div>
  );
}
