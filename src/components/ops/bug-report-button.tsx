"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Bug, X, Send, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

import { useAuthStore } from "@/lib/store/auth-store";
import {
  BugReportService,
  type BugReportCategory,
  type BugReportPriority,
} from "@/lib/api/services/bug-report-service";
import {
  getBugContext,
  initBugContext,
  screenNameFromPath,
} from "@/lib/utils/bug-context";
import { useDictionary } from "@/i18n/client";

type FormState = "idle" | "submitting" | "success" | "error";
type Severity = "blocker" | "major" | "minor";

const CATEGORY_OPTIONS: { value: BugReportCategory; labelKey: string }[] = [
  { value: "bug", labelKey: "bugReport.category.bug" },
  { value: "ui_issue", labelKey: "bugReport.category.ui" },
  { value: "crash", labelKey: "bugReport.category.crash" },
  { value: "feature_request", labelKey: "bugReport.category.feature" },
  { value: "other", labelKey: "bugReport.category.other" },
];

const SEVERITY_OPTIONS: { value: Severity; labelKey: string }[] = [
  { value: "blocker", labelKey: "bugReport.severity.blocker" },
  { value: "major", labelKey: "bugReport.severity.major" },
  { value: "minor", labelKey: "bugReport.severity.minor" },
];

// User-chosen severity maps to the triage `priority` column as a starting
// signal. Admins can override during triage — this is a hint, not a verdict.
const SEVERITY_TO_PRIORITY: Record<Severity, BugReportPriority> = {
  blocker: "urgent",
  major: "high",
  minor: "low",
};

export function BugReportButton() {
  const { t } = useDictionary("common");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<BugReportCategory>("bug");
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [requiresMyInput, setRequiresMyInput] = useState(false);
  const [formState, setFormState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [screenshotBlob, setScreenshotBlob] = useState<Blob | null>(null);
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const pathname = usePathname();
  const { currentUser, company } = useAuthStore();
  const sidebarWidth = 72;

  // Minimal-form gate. Trades business owners get one textarea + submit;
  // power user (the developer) gets full triage controls. Defaults applied
  // for hidden fields: category='bug', severity=null, requiresHumanReview=false,
  // screenshot=included.
  const isPowerUser = currentUser?.email === "canprojack@gmail.com";

  useEffect(() => {
    initBugContext();
  }, []);

  /**
   * Capture the viewport BEFORE the bug form is visible, so the screenshot
   * shows what the user was actually looking at when they hit the bug button.
   * modern-screenshot handles backdrop-filter / custom fonts better than
   * html2canvas, which is important for this app's frosted-glass surfaces.
   */
  const handleOpen = useCallback(async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setCapturingScreenshot(true);
    try {
      const { domToBlob } = await import("modern-screenshot");
      const blob = await domToBlob(document.body, {
        type: "image/png",
        quality: 0.85,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        backgroundColor: "#0A0A0A",
        filter: (node) => {
          if (!(node instanceof HTMLElement)) return true;
          // Skip the bug report button itself and anything that opts out
          if (node.dataset?.bugReportIgnore === "true") return false;
          return true;
        },
      });
      setScreenshotBlob(blob);
    } catch (err) {
      // Screenshot is best-effort — the report still submits without it.
      console.warn("Bug report screenshot capture failed:", err);
      setScreenshotBlob(null);
    } finally {
      setCapturingScreenshot(false);
      setOpen(true);
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  function handleClose() {
    if (formState === "submitting") return;
    setOpen(false);
    // Reset after animation
    setTimeout(() => {
      setTitle("");
      setDescription("");
      setCategory("bug");
      setSeverity(null);
      setRequiresMyInput(false);
      setFormState("idle");
      setErrorMessage(null);
      setScreenshotBlob(null);
      setIncludeScreenshot(true);
    }, 200);
  }

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || formState === "submitting") return;

    if (!currentUser?.id || !currentUser.companyId) {
      setFormState("error");
      setErrorMessage("You must be signed in to submit a bug report.");
      return;
    }

    setFormState("submitting");
    setErrorMessage(null);

    try {
      const ctx = getBugContext({
        stateSnapshot: {
          companyName: company?.name ?? null,
          userRole: currentUser.role ?? null,
          isCompanyAdmin: currentUser.isCompanyAdmin ?? null,
        },
        customMetadata: {
          submittedFrom: "bug-report-button",
        },
      });

      // bug_reports.description is NOT NULL. Merge title + details so the
      // column is always populated, and keep the user's title as a leading line.
      const trimmedTitle = title.trim();
      const trimmedDetails = description.trim();
      const fullDescription = trimmedDetails
        ? `${trimmedTitle}\n\n${trimmedDetails}`
        : trimmedTitle;

      const reporterName = [currentUser.firstName, currentUser.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();

      const reportId = await BugReportService.createReport({
        companyId: currentUser.companyId,
        reporterId: currentUser.id,
        description: fullDescription,
        category,
        platform: "web",
        ...(severity ? { priority: SEVERITY_TO_PRIORITY[severity] } : {}),
        requiresHumanReview: requiresMyInput,
        humanReviewReason: requiresMyInput
          ? "Reporter flagged at submission: needs their follow-up to resolve."
          : null,

        browser: ctx.browser,
        browserVersion: ctx.browserVersion,
        osName: ctx.osName,
        osVersion: ctx.osVersion,
        deviceModel: ctx.deviceModel,

        viewportWidth: ctx.viewportWidth,
        viewportHeight: ctx.viewportHeight,

        screenName: screenNameFromPath(ctx.pathname),
        url: ctx.url,

        networkType: ctx.networkType,

        consoleLogs: ctx.consoleLogs,
        breadcrumbs: ctx.breadcrumbs,
        networkLog: [],
        stateSnapshot: ctx.stateSnapshot,
        customMetadata: {
          ...ctx.customMetadata,
          userAgent: ctx.userAgent,
          referrer: ctx.referrer,
          language: ctx.language,
          timezone: ctx.timezone,
          online: ctx.online,
          devicePixelRatio: ctx.devicePixelRatio,
          screenWidth: ctx.screenWidth,
          screenHeight: ctx.screenHeight,
          userTitle: trimmedTitle,
          userSeverity: severity,
        },

        reporterName: reporterName || null,
        reporterEmail: currentUser.email ?? null,
      });

      // Upload screenshot if we have one and the user didn't opt out — best
      // effort, doesn't block success. Goes through a server API because
      // client-side storage writes fail the bug-reports bucket RLS: ops-web's
      // Supabase client uses a Firebase JWT which does not produce the
      // Postgres "authenticated" role that the bucket's INSERT policy requires.
      if (screenshotBlob && includeScreenshot) {
        try {
          const { getFirebaseAuth } = await import("@/lib/firebase/config");
          const fbAuth = getFirebaseAuth();
          const fbUser = fbAuth.currentUser;
          if (!fbUser) throw new Error("No Firebase user for screenshot upload");

          const idToken = await fbUser.getIdToken();

          const form = new FormData();
          form.append("file", screenshotBlob, "screenshot.png");
          form.append("reportId", reportId);
          form.append("companyId", currentUser.companyId);

          const resp = await fetch("/api/bug-reports/screenshot", {
            method: "POST",
            headers: { Authorization: `Bearer ${idToken}` },
            body: form,
          });

          if (!resp.ok) {
            const errBody = await resp.json().catch(() => ({}));
            throw new Error(errBody.error ?? `Upload failed with status ${resp.status}`);
          }
        } catch (uploadErr) {
          console.warn("Bug report screenshot upload failed:", uploadErr);
        }
      }

      setFormState("success");
      setTimeout(() => {
        handleClose();
      }, 1200);
    } catch (err) {
      console.error("Bug report submission failed:", err);
      setFormState("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to submit bug report."
      );
    }
  }, [title, description, category, severity, requiresMyInput, formState, currentUser, company, screenshotBlob, includeScreenshot]);

  // Don't render on dashboard (map filter rail occupies bottom-left)
  // Don't render on intel (full-bleed canvas, overlaps cluster legend)
  if (pathname === "/dashboard" || pathname === "/intel") return null;

  return (
    <div
      ref={containerRef}
      className="fixed z-[90]"
      style={{ bottom: 16, left: sidebarWidth + 12 }}
      data-bug-report-ignore="true"
    >
      {/* Popover form */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
            }
            className="absolute bottom-[44px] left-0 w-[320px] rounded-sm overflow-hidden"
            style={{
              background: "var(--surface-glass)",
              backdropFilter: "blur(28px) saturate(1.3)",
              WebkitBackdropFilter: "blur(28px) saturate(1.3)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-[rgba(255,255,255,0.08)]">
              <span className="font-mono text-micro uppercase tracking-wider text-text-2">
                {t("bugReport.title")}
              </span>
              <button
                onClick={handleClose}
                className="p-1 text-text-mute hover:text-text-2 transition-colors duration-150"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Body */}
            <div className="p-3 space-y-2.5">
              {formState === "success" ? (
                <div className="flex flex-col items-center justify-center py-4 gap-2">
                  <CheckCircle2 className="w-5 h-5 text-ops-accent" />
                  <p className="font-mohave text-body-sm text-text-2 text-left">
                    {t("bugReport.submitted")}
                  </p>
                </div>
              ) : (
                <>
                  {isPowerUser && (
                    /* Category — required. Chip grid wraps to handle longer
                        localizations (e.g. Spanish "FEATURE REQUEST"). */
                    <div>
                      <label className="font-mono text-micro uppercase tracking-wider text-text-3 mb-1 block">
                        {t("bugReport.category")}
                      </label>
                      <div
                        role="radiogroup"
                        aria-label={t("bugReport.category")}
                        className="flex flex-wrap gap-1"
                      >
                        {CATEGORY_OPTIONS.map((opt) => {
                          const isActive = category === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              role="radio"
                              aria-checked={isActive}
                              onClick={() => setCategory(opt.value)}
                              className={cn(
                                "px-2 py-1 rounded-[4px] border transition-colors duration-150",
                                "font-mono text-[10px] uppercase tracking-wider",
                                isActive
                                  ? "border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.08)] text-text"
                                  : "border-[rgba(255,255,255,0.08)] bg-transparent text-text-mute hover:text-text-2 hover:bg-[rgba(255,255,255,0.03)]"
                              )}
                            >
                              {t(opt.labelKey)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Primary input — single field for minimal users
                      (their text becomes the full report), title+description
                      pair for the power user. */}
                  {isPowerUser ? (
                    <>
                      <div>
                        <label className="font-mono text-micro uppercase tracking-wider text-text-3 mb-1 block">
                          {t("bugReport.whatHappened")}
                        </label>
                        <input
                          type="text"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder={t("bugReport.titlePlaceholder")}
                          className={cn(
                            "w-full px-2.5 py-2 rounded-sm font-mohave text-body-sm text-text",
                            "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)]",
                            "placeholder:text-text-mute",
                            "focus:outline-none focus:border-[rgba(255,255,255,0.20)]/40",
                            "transition-colors duration-150"
                          )}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSubmit();
                            }
                          }}
                        />
                      </div>

                      <div>
                        <label className="font-mono text-micro uppercase tracking-wider text-text-3 mb-1 block">
                          {t("bugReport.details")}
                        </label>
                        <textarea
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder={t("bugReport.detailsPlaceholder")}
                          rows={3}
                          className={cn(
                            "w-full px-2.5 py-2 rounded-sm font-mohave text-body-sm text-text resize-none",
                            "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)]",
                            "placeholder:text-text-mute",
                            "focus:outline-none focus:border-[rgba(255,255,255,0.20)]/40",
                            "transition-colors duration-150"
                          )}
                        />
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="font-mono text-micro uppercase tracking-wider text-text-3 mb-1 block">
                        {t("bugReport.whatHappened")}
                      </label>
                      <textarea
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t("bugReport.titlePlaceholder")}
                        rows={4}
                        className={cn(
                          "w-full px-2.5 py-2 rounded-sm font-mohave text-body-sm text-text resize-none",
                          "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)]",
                          "placeholder:text-text-mute",
                          "focus:outline-none focus:border-[rgba(255,255,255,0.20)]/40",
                          "transition-colors duration-150"
                        )}
                        autoFocus
                      />
                    </div>
                  )}

                  {isPowerUser && (
                    /* Severity — optional. Writes to `priority` as a hint; admin
                        can override during triage. Click active chip to clear. */
                    <div>
                      <label className="font-mono text-micro uppercase tracking-wider text-text-3 mb-1 block">
                        {t("bugReport.severity")}
                      </label>
                      <div role="radiogroup" aria-label={t("bugReport.severity")} className="flex gap-1">
                        {SEVERITY_OPTIONS.map((opt) => {
                          const isActive = severity === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              role="radio"
                              aria-checked={isActive}
                              onClick={() => setSeverity(isActive ? null : opt.value)}
                              className={cn(
                                "flex-1 px-2 py-1.5 rounded-[4px] border transition-colors duration-150",
                                "font-mono text-[10px] uppercase tracking-wider",
                                isActive
                                  ? "border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.08)] text-text"
                                  : "border-[rgba(255,255,255,0.08)] bg-transparent text-text-mute hover:text-text-2 hover:bg-[rgba(255,255,255,0.03)]"
                              )}
                            >
                              {t(opt.labelKey)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {isPowerUser && (
                    /* Requires-my-input toggle. When on, the nightly triage
                        agent skips this report (written to requires_human_review). */
                    <button
                      type="button"
                      role="switch"
                      aria-checked={requiresMyInput}
                      onClick={() => setRequiresMyInput((v) => !v)}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-[4px] border transition-colors",
                        requiresMyInput
                          ? "border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.06)]"
                          : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] hover:border-[rgba(255,255,255,0.14)]"
                      )}
                    >
                      <span
                        className={cn(
                          "font-mono text-[10px] uppercase tracking-wider text-left",
                          requiresMyInput ? "text-text-2" : "text-text-mute"
                        )}
                      >
                        {requiresMyInput
                          ? `[${t("bugReport.requiresInputOn")}]`
                          : t("bugReport.requiresInputOff")}
                      </span>
                      <span
                        className={cn(
                          "relative inline-block w-6 h-3 rounded-full transition-colors flex-shrink-0",
                          requiresMyInput
                            ? "bg-[rgba(255,255,255,0.2)]"
                            : "bg-[rgba(255,255,255,0.08)]"
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-[1px] w-[10px] h-[10px] rounded-full transition-all",
                            requiresMyInput
                              ? "left-[13px] bg-text-2"
                              : "left-[1px] bg-text-disabled"
                          )}
                        />
                      </span>
                    </button>
                  )}

                  {/* Auto-captured context. Power user gets a screenshot toggle;
                      minimal users get the screenshot attached silently. */}
                  <div className="space-y-1.5">
                    <p className="font-mono text-micro text-text-mute tracking-wider">
                      {t("bugReport.autoCapture")}
                    </p>
                    {isPowerUser && screenshotBlob && (
                      <button
                        type="button"
                        onClick={() => setIncludeScreenshot((v) => !v)}
                        className={cn(
                          "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-sm border transition-colors",
                          includeScreenshot
                            ? "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.05)]"
                            : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)]"
                        )}
                      >
                        <span
                          className={cn(
                            "font-mono text-micro tracking-wider uppercase text-left",
                            includeScreenshot ? "text-ops-accent" : "text-text-mute"
                          )}
                        >
                          {includeScreenshot
                            ? `[ATTACH SCREENSHOT · ${Math.round(screenshotBlob.size / 1024)}KB]`
                            : "[SCREENSHOT OFF]"}
                        </span>
                        <span
                          className={cn(
                            "relative inline-block w-6 h-3 rounded-full transition-colors flex-shrink-0",
                            includeScreenshot
                              ? "bg-ops-accent/40"
                              : "bg-[rgba(255,255,255,0.08)]"
                          )}
                        >
                          <span
                            className={cn(
                              "absolute top-[1px] w-[10px] h-[10px] rounded-full transition-all",
                              includeScreenshot
                                ? "left-[13px] bg-ops-accent"
                                : "left-[1px] bg-text-disabled"
                            )}
                          />
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Error state */}
                  {formState === "error" && errorMessage && (
                    <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-sm border border-[rgba(220,80,80,0.3)] bg-[rgba(220,80,80,0.08)]">
                      <AlertCircle className="w-3 h-3 text-[#E57373] mt-[2px] flex-shrink-0" />
                      <p className="font-mono text-micro tracking-wider text-[#E57373] break-words">
                        {errorMessage}
                      </p>
                    </div>
                  )}

                  {/* Submit */}
                  <button
                    onClick={handleSubmit}
                    disabled={!title.trim() || formState === "submitting"}
                    className={cn(
                      "w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-sm",
                      "font-mono text-micro uppercase tracking-wider",
                      "transition-all duration-150",
                      title.trim() && formState !== "submitting"
                        ? "bg-[rgba(255,255,255,0.08)] text-ops-accent border border-[rgba(255,255,255,0.15)] hover:bg-ops-accent/30"
                        : "bg-[rgba(255,255,255,0.04)] text-text-mute border border-[rgba(255,255,255,0.06)] cursor-not-allowed"
                    )}
                  >
                    {formState === "submitting" ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Send className="w-3 h-3" />
                    )}
                    {formState === "submitting"
                      ? t("bugReport.sending")
                      : t("bugReport.submit")}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bug button */}
      <motion.button
        onClick={handleOpen}
        disabled={capturingScreenshot}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={
          prefersReducedMotion
            ? { duration: 0 }
            : { duration: 0.3, ease: [0.22, 1, 0.36, 1] }
        }
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5 rounded-[5px]",
          "glass-surface",
          "hover:border-[rgba(255,255,255,0.18)]",
          "transition-colors duration-150",
          open && "!border-[rgba(255,255,255,0.20)]",
          capturingScreenshot && "opacity-60 cursor-wait"
        )}
        title={t("bugReport.title")}
      >
        {capturingScreenshot ? (
          <Loader2 className="w-[13px] h-[13px] text-text-mute animate-spin" />
        ) : (
          <Bug className="w-[13px] h-[13px] text-text-mute" />
        )}
        <span className="font-mono text-micro text-text-mute tracking-wider uppercase select-none">
          {t("bugReport.label")}
        </span>
      </motion.button>
    </div>
  );
}
