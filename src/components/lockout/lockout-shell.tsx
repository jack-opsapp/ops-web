"use client";

import { type ReactNode, useCallback, useRef } from "react";
import { Headphones } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { useAuthStore } from "@/lib/store/auth-store";
import { useSetupStore } from "@/stores/setup-store";
import { signOut } from "@/lib/firebase/auth";

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
  const isPage = variant === "page";
  const switchingRef = useRef(false);

  // Clearing the session before navigating /login is mandatory. The middleware
  // sees the still-valid Firebase cookies (__session / ops-auth-token) and
  // redirects /login -> /dashboard, which re-mounts this same lockout dialog —
  // the button reads as dead. Clear the cookies FIRST (so the redirect can't
  // read them), reset client stores, then sign out. Mirrors the cleanup
  // sequence in src/components/ops/sign-out-overlay.tsx (bug a1cc9a86).
  const handleSwitchAccount = useCallback(async () => {
    if (switchingRef.current) return;
    switchingRef.current = true;

    document.cookie = "ops-auth-token=; path=/; max-age=0";
    document.cookie = "__session=; path=/; max-age=0";

    useSetupStore.getState().reset();
    useAuthStore.getState().logout();

    try {
      await signOut();
    } catch {
      // Best-effort — the cookies are already cleared, so middleware cannot
      // bounce us back. Proceed to /login regardless.
    }

    // Full document navigation drops the in-memory React tree the lockout
    // dialog mounted from.
    window.location.href = "/login";
  }, []);

  return (
    <div
      className={cn(
        isPage
          ? "glass-surface w-full max-w-[1080px] mx-auto p-6 md:p-8"
          : "glass-dense w-full max-w-[1080px] mx-auto p-6 md:p-8",
        "rounded overflow-hidden",
        // Override the .glass-surface / .glass-dense ::before pseudo
        // (10/12px) to match the parent's 5px corner — otherwise the
        // gradient overlay paints in a wider band than the fill.
        "[&::before]:rounded"
      )}
    >
      {/* Top rail */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <span
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border font-mono text-[11px] uppercase tracking-[0.12em]",
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
      </div>

      {/* Hero */}
      <div className="mb-6">
        <h2
          id="lockout-heading"
          className="font-cakemono font-light text-[30px] uppercase tracking-tight text-text leading-none mb-3"
        >
          {heading}
        </h2>
        <p className="font-mohave text-[14px] text-text-2 leading-[1.45]">
          {body}
        </p>
      </div>

      {/* Section divider */}
      <div className="flex items-center gap-3 mb-5">
        <span className="flex-1 h-px bg-[var(--line,rgba(255,255,255,0.10))]" />
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {sectionLabel}
        </span>
        <span className="flex-1 h-px bg-[var(--line,rgba(255,255,255,0.10))]" />
      </div>

      {/* State module slot */}
      <div className="mb-6">{children}</div>

      {/* Footer */}
      <div>
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
              <button
                type="button"
                onClick={handleSwitchAccount}
                className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3 hover:text-text-2 transition-colors cursor-pointer"
              >
                <span className="text-text-mute">{"// "}</span>
                {t("lockout.shared.switchAccount").toUpperCase()}
              </button>
            )}
          </div>
          <span className="font-mono text-[11px] tracking-[0.12em] text-text-mute">
            {fingerprint}
          </span>
        </div>
      </div>
    </div>
  );
}
