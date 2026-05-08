"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Headphones } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  lockoutShellChildVariants,
  lockoutShellChildVariantsReduced,
  lockoutShellStaggerVariants,
} from "@/lib/utils/motion";

export interface LockoutShellTagProps {
  tone: "rose" | "tan";
  label: string;
}

export interface LockoutShellProps {
  variant: "page" | "overlay";
  tag: LockoutShellTagProps;
  heading: string;
  body: string;
  sectionLabel: string;
  fingerprint: string;
  children: ReactNode;
  showSwitchAccount?: boolean;
}

const TONE_CLASSES: Record<LockoutShellTagProps["tone"], string> = {
  rose: "bg-[var(--rose-soft)] text-[var(--rose)] border-[var(--rose-line)]",
  tan: "bg-[var(--tan-soft)] text-[var(--tan)] border-[var(--tan-line)]",
};

export function LockoutShell({
  variant,
  tag,
  heading,
  body,
  sectionLabel,
  fingerprint,
  children,
  showSwitchAccount = true,
}: LockoutShellProps) {
  const { t } = useDictionary("auth");
  const prefersReducedMotion = useReducedMotion();
  const childVariants = useMemo(
    () =>
      prefersReducedMotion ? lockoutShellChildVariantsReduced : lockoutShellChildVariants,
    [prefersReducedMotion]
  );

  const isPage = variant === "page";

  return (
    <motion.div
      className={cn(
        isPage
          ? "glass-surface w-full max-w-[720px] mx-auto p-8"
          : "glass-dense w-full max-w-[520px] mx-auto p-6",
        "rounded-[5px] overflow-hidden"
      )}
      variants={lockoutShellStaggerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Top rail */}
      <motion.div
        variants={childVariants}
        className="flex items-center justify-between gap-3 mb-4"
      >
        <span
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[2.5px] border font-mono text-[11px] uppercase tracking-[0.12em]",
            TONE_CLASSES[tag.tone]
          )}
        >
          {tag.label}
        </span>
        <a
          href="mailto:support@opsapp.co"
          className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 hover:text-text-2 transition-colors"
        >
          <span className="text-text-mute">{"// "}</span>
          {t("lockout.shared.contactSupport").toUpperCase()}
        </a>
      </motion.div>

      {/* Hero */}
      <motion.div variants={childVariants} className="mb-6">
        <h2
          id="lockout-heading"
          className="font-cakemono font-light text-[30px] uppercase tracking-tight text-text leading-none mb-3"
        >
          {heading}
        </h2>
        <p className="font-mohave text-[14px] text-text-2 leading-[1.45]">
          {body}
        </p>
      </motion.div>

      {/* Section divider */}
      <motion.div
        variants={childVariants}
        className="flex items-center gap-3 mb-5"
      >
        <span className="flex-1 h-px bg-[var(--line,rgba(255,255,255,0.10))]" />
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {sectionLabel}
        </span>
        <span className="flex-1 h-px bg-[var(--line,rgba(255,255,255,0.10))]" />
      </motion.div>

      {/* State module slot */}
      <motion.div variants={childVariants} className="mb-6">
        {children}
      </motion.div>

      {/* Footer */}
      <motion.div variants={childVariants}>
        <div className="h-px bg-[var(--line,rgba(255,255,255,0.10))] mb-3" />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <a
              href="mailto:support@opsapp.co"
              className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 hover:text-text-2 transition-colors"
            >
              <Headphones className="w-[12px] h-[12px]" aria-hidden="true" />
              {t("lockout.shared.contactSupport").toUpperCase()}
            </a>
            {showSwitchAccount && (
              <Link
                href="/login"
                className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 hover:text-text-2 transition-colors"
              >
                <span className="text-text-mute">{"// "}</span>
                {t("lockout.shared.switchAccount").toUpperCase()}
              </Link>
            )}
          </div>
          <span className="font-mono text-[11px] tracking-[0.12em] text-text-mute">
            {fingerprint}
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
