"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";

const EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

interface ReconnectInboxClientProps {
  companyId: string;
  userId: string;
  type: "company" | "individual";
  provider: "gmail" | "microsoft365";
  connectionId: string;
  expectedEmail: string;
  companyName: string;
  userName: string | null;
  userEmail: string | null;
}

const PROVIDER_DISPLAY: Record<
  ReconnectInboxClientProps["provider"],
  { label: string; cta: string }
> = {
  gmail: { label: "Google", cta: "Continue to Google" },
  microsoft365: { label: "Microsoft", cta: "Continue to Microsoft" },
};

export function ReconnectInboxClient({
  companyId,
  userId,
  type,
  provider,
  connectionId,
  expectedEmail,
  companyName,
  userName,
  userEmail,
}: ReconnectInboxClientProps) {
  const reduced = useReducedMotion();
  const t = (delay = 0) =>
    reduced ? { duration: 0 } : { duration: 0.4, ease: EASE_SMOOTH, delay };

  const providerCopy = PROVIDER_DISPLAY[provider];

  // Build the OAuth start URL exactly as the in-app reconnect button does,
  // plus a `source=alert` so the callback knows to redirect to our success
  // page instead of /settings.
  const oauthHref = React.useMemo(() => {
    const params = new URLSearchParams({
      companyId,
      userId,
      type,
      source: "alert",
      connectionId,
      expectedEmail,
    });
    return `/api/integrations/${provider}?${params.toString()}`;
  }, [companyId, userId, type, provider, connectionId, expectedEmail]);

  // "Sign in as a different user" route — drops them on /login. After they
  // authenticate the redirect lands them on the integrations tab where they
  // can complete the reconnect with their preferred user identity.
  const switchUserHref =
    "/login?redirect=" + encodeURIComponent("/settings?tab=integrations");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="flex w-full max-w-[460px] flex-col">
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={t()}
          className="mb-6 font-cakemono font-light uppercase text-text"
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
          <div
            className="mb-5 font-cakemono font-light uppercase text-text-3"
            style={{
              fontSize: "11px",
              letterSpacing: "0.18em",
              lineHeight: "14px",
            }}
          >
            {"// "}Inbox // Reconnect
          </div>

          <h1
            className="mb-2 font-mohave text-text"
            style={{ fontSize: "26px", lineHeight: "32px", fontWeight: 600 }}
          >
            Reconnect {companyName}&apos;s inbox
          </h1>

          <p
            className="mb-6 font-mohave text-text-2"
            style={{ fontSize: "15px", lineHeight: "22px" }}
          >
            You&rsquo;ll re-grant access through {providerCopy.label}. Takes
            about thirty seconds. Nothing changes on the OPS side until
            you&rsquo;re back.
          </p>

          {/* Inline identity card — gives the operator a chance to spot a
              wrong-account click before they hand mailbox scope to a third
              party. Same visual language as the InfoBlock primitive in the
              email template. */}
          <div
            className="mb-6 rounded p-4"
            style={{
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.10)",
            }}
          >
            <IdentityRow label="Company">{companyName}</IdentityRow>
            <IdentityRow
              label="Reconnecting as"
              valueClassName={
                userName
                  ? "font-mohave text-text"
                  : "font-mono text-text-3 italic"
              }
            >
              {userName ?? "your team"}
              {userEmail ? (
                <span className="mt-[2px] block font-mono text-[11px] text-text-3">
                  {userEmail}
                </span>
              ) : null}
            </IdentityRow>
            <IdentityRow label="Account type" last>
              {type === "company" ? "Company inbox" : "Personal inbox"}
            </IdentityRow>
          </div>

          <a
            href={oauthHref}
            className="flex w-full items-center justify-start rounded border border-ops-accent px-4 font-cakemono font-light uppercase text-ops-accent transition-colors duration-200 hover:bg-ops-accent hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            style={{
              minHeight: "60px",
              fontSize: "13px",
              letterSpacing: "0.16em",
              textDecoration: "none",
            }}
          >
            {providerCopy.cta} →
          </a>

          <a
            href={switchUserHref}
            className="mt-3 block font-mono uppercase text-text-3 transition-colors hover:text-text-2"
            style={{ fontSize: "11px", letterSpacing: "0.12em" }}
          >
            [Sign in as someone else]
          </a>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={t(0.16)}
          className="mt-5 font-mono uppercase text-text-mute"
          style={{ fontSize: "11px", letterSpacing: "0.12em" }}
        >
          [stuck — reply to the alert email]
        </motion.p>
      </div>
    </div>
  );
}

function IdentityRow({
  label,
  children,
  last,
  valueClassName,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
  valueClassName?: string;
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
        className="mb-1 font-mono uppercase text-text-3"
        style={{ fontSize: "11px", letterSpacing: "0.16em" }}
      >
        {label}
      </div>
      <div
        className={valueClassName ?? "font-mohave text-text"}
        style={{ fontSize: "15px", lineHeight: "20px" }}
      >
        {children}
      </div>
    </div>
  );
}
