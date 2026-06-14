"use client";

/**
 * ConnectPanel — the single entry point for linking accounting software
 * (WEB OVERHAUL P3-4). Replaces the two side-by-side provider cards (§6
 * canonical failure: a user picks ONE provider, once).
 *
 * Two states:
 *   "connect"   — never connected. One CONNECT ACCOUNTING SOFTWARE CTA +
 *                 an honest, two-way "what happens" spec sheet.
 *   "reconnect" — a connection exists but went offline (token expired/revoked).
 *                 A focused RECONNECT {provider} CTA; we already know which.
 *
 * The CTA is the 36px standard primary button (page-level setup action, not a
 * workbar control — DESIGN.md §9 compact-tier carve-out).
 */

import { Link2 } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </p>
  );
}

export function ConnectPanel({
  variant = "connect",
  providerName,
  onConnect,
  connecting = false,
}: {
  variant?: "connect" | "reconnect";
  providerName?: string;
  onConnect: () => void;
  connecting?: boolean;
}) {
  const { t } = useDictionary("books");

  if (variant === "reconnect") {
    return (
      <div className="glass-surface max-w-[640px] space-y-3 p-6">
        <Eyebrow>{t("sync.reconnect.eyebrow")}</Eyebrow>
        <p className="max-w-[480px] font-mohave text-body-sm leading-relaxed text-text-2">
          {t("sync.reconnect.body", { provider: providerName ?? "" })}
        </p>
        <Button variant="primary" onClick={onConnect} loading={connecting} className="gap-1.5">
          <Link2 className="h-[15px] w-[15px]" />
          {t("sync.reconnect.cta", { provider: providerName ?? "" })}
        </Button>
      </div>
    );
  }

  const steps = [
    [t("sync.connect.step1Label"), t("sync.connect.step1")],
    [t("sync.connect.step2Label"), t("sync.connect.step2")],
    [t("sync.connect.step3Label"), t("sync.connect.step3")],
  ] as const;

  return (
    <div className="glass-surface max-w-[640px] p-6">
      <Eyebrow>{t("sync.connect.eyebrow")}</Eyebrow>
      <h2 className="mt-2.5 font-cakemono text-[18px] font-light uppercase text-text">
        {t("sync.connect.heading")}
      </h2>
      <p className="mb-[18px] mt-1.5 max-w-[500px] font-mohave text-body-sm leading-relaxed text-text-2">
        {t("sync.connect.body")}
      </p>

      <Button variant="primary" onClick={onConnect} loading={connecting} className="gap-1.5">
        <Link2 className="h-[15px] w-[15px]" />
        {t("sync.connect.cta")}
      </Button>

      <div className="mt-5 border-t border-border pt-4">
        <Eyebrow>{t("sync.connect.whatHappens")}</Eyebrow>
        <div className="mt-2.5 space-y-2.5">
          {steps.map(([label, body]) => (
            <div key={label} className="flex items-start gap-3">
              <span className="w-[88px] shrink-0 pt-[2px] font-mono text-micro uppercase tracking-[0.12em] text-text-3">
                {label}
              </span>
              <p className="font-mohave text-body-sm leading-relaxed text-text-2">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
