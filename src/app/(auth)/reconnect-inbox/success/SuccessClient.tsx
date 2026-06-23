"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

interface ReconnectSuccessClientProps {
  companyName: string;
  inboxAddress: string;
  provider: "gmail" | "microsoft365";
  isAuthenticated: boolean;
}

export function ReconnectSuccessClient({
  companyName,
  inboxAddress,
  provider,
  isAuthenticated,
}: ReconnectSuccessClientProps) {
  const reduced = useReducedMotion();
  const t = (delay = 0) =>
    reduced ? { duration: 0 } : { duration: 0.4, ease: EASE_SMOOTH, delay };

  const providerLabel = provider === "gmail" ? "Gmail" : "Outlook";

  // Logged-in: walk them straight back into integrations to verify the new
  // state. Logged-out: send them through /login first, then forward to the
  // same destination.
  const settingsHref = "/settings?tab=integrations";
  const primaryHref = isAuthenticated
    ? settingsHref
    : `/login?redirect=${encodeURIComponent(settingsHref)}`;
  const primaryLabel = isAuthenticated ? "Open settings" : "Log in to OPS";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[460px] flex flex-col">
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={t()}
          className="font-cakemono font-light uppercase text-text mb-6"
          style={{ fontSize: "20px", letterSpacing: "0.18em" }}
        >
          OPS
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={t(0.08)}
          className="w-full rounded-panel p-6 sm:p-8"
          style={{
            background: "rgba(18, 18, 20, 0.58)",
            backdropFilter: "blur(28px) saturate(1.3)",
            WebkitBackdropFilter: "blur(28px) saturate(1.3)",
            border: "1px solid rgba(255, 255, 255, 0.09)",
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={t(0.12)}
            className="inline-flex items-center gap-2 px-2 py-1 rounded-chip font-cakemono font-light uppercase mb-4"
            style={{
              color: "#9DB582",
              border: "1px solid #9DB582",
              background: "transparent",
              fontSize: "11px",
              letterSpacing: "0.18em",
            }}
          >
            {"// "}Connected
          </motion.div>

          <h1
            className="font-mohave text-text mb-2 break-words"
            style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
          >
            {inboxAddress} is back online
          </h1>

          <p
            className="font-mohave text-text-2 mb-6"
            style={{ fontSize: "15px", lineHeight: "22px" }}
          >
            {isAuthenticated
              ? `New ${providerLabel} emails will start landing in your OPS pipeline within a minute.`
              : `New ${providerLabel} emails will start landing in your OPS pipeline within a minute. You're signed out — log in to see them.`}
          </p>

          <div
            className="rounded p-4 mb-6"
            style={{
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.10)",
            }}
          >
            <SuccessRow label="Inbox">{inboxAddress}</SuccessRow>
            <SuccessRow label="Company" last>
              {companyName}
            </SuccessRow>
          </div>

          <a
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
          </a>

          {!isAuthenticated ? (
            <p
              className="mt-3 font-mono uppercase text-text-mute"
              style={{ fontSize: "11px", letterSpacing: "0.12em" }}
            >
              [your inbox is already reconnected — log in is just to view it]
            </p>
          ) : null}
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={t(0.16)}
          className="font-mono uppercase text-text-mute mt-5"
          style={{ fontSize: "11px", letterSpacing: "0.12em" }}
        >
          [you can close this tab now]
        </motion.p>
      </div>
    </div>
  );
}

function SuccessRow({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={last ? "" : "mb-3 pb-3"}
      style={
        last
          ? undefined
          : { borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }
      }
    >
      <div
        className="font-mono uppercase text-text-3 mb-1"
        style={{ fontSize: "11px", letterSpacing: "0.16em" }}
      >
        {label}
      </div>
      <div
        className="font-mohave text-text break-words"
        style={{ fontSize: "15px", lineHeight: "20px" }}
      >
        {children}
      </div>
    </div>
  );
}
