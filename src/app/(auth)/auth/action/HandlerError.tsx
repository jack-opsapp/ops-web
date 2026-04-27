"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { handlerCopy } from "./copy";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

export type ErrorKind =
  | "malformed"
  | "expired"
  | "alreadyUsed"
  | "userDisabled"
  | "network"
  | "unknown";

interface HandlerErrorProps {
  kind: ErrorKind;
  onPrimary?: () => void;
  onSecondary?: () => void;
}

export function HandlerError({
  kind,
  onPrimary,
  onSecondary,
}: HandlerErrorProps) {
  const reduced = useReducedMotion();
  const c = handlerCopy.errors[kind];
  const secondary =
    "secondaryCta" in c
      ? (c as { secondaryCta?: string }).secondaryCta
      : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduced ? { duration: 0 } : { duration: 0.35, ease: EASE_SMOOTH }
      }
    >
      <h1
        className="font-mohave text-text-primary mb-3"
        style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
      >
        {c.headline}
      </h1>
      <p
        className="font-mohave text-text-2 mb-6"
        style={{ fontSize: "15px", lineHeight: "22px" }}
      >
        {c.body}
      </p>
      <button
        type="button"
        onClick={onPrimary}
        className="w-full rounded-[5px] font-cakemono font-light uppercase text-ops-accent border border-ops-accent transition-colors duration-200 hover:bg-ops-accent hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        style={{
          minHeight: "60px",
          fontSize: "13px",
          letterSpacing: "0.16em",
        }}
      >
        {c.primaryCta} →
      </button>
      {secondary ? (
        <button
          type="button"
          onClick={onSecondary}
          className="block w-full mt-3 font-mono uppercase text-text-3 hover:text-text-2 transition-colors text-left"
          style={{ fontSize: "11px", letterSpacing: "0.12em" }}
        >
          [{secondary}]
        </button>
      ) : null}
    </motion.div>
  );
}
