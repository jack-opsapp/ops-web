"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Bug, X, Send, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

import { useAuthStore } from "@/lib/store/auth-store";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { EdgeTab } from "@/components/ui/edge-tab";
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
import { Switch } from "@/components/ui/switch";

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

// EdgeTab integration (bug-b842f0ff): the report trigger is now a right-rail
// edge tab that mirrors NotificationsTab + QuickActionsTab. Stack math:
//   Notifications (180px) sits above center at -94.
//   Quick Actions (132px) sits below center at +94.
//   Bug Report tab sits BELOW Quick Actions: top edge = +160, +8px gap, our
//   own restHeight = 64 (icon-only square-ish) → tab center = +200.
//
// Form panel reuses Quick Actions' panel-anchored geometry (308×420) so the
// tab + panel read as one shape when expanded.
const EDGE_TAB_ID = "bug-report";
const STACK_OFFSET_BUG = 200;
const REST_HEIGHT_BUG = 64;
const PANEL_W = 308;
const PANEL_H = 420;
const RAIL_TOP = 72;
const RAIL_BOTTOM = 16;

export function BugReportButton() {
  const { t } = useDictionary("common");
  const pathname = usePathname();
  const open = useEdgeTabStore((s) => s.activeTab === EDGE_TAB_ID);
  const anyActive = useEdgeTabStore((s) => s.activeTab !== null);
  const toggle = useEdgeTabStore((s) => s.toggle);
  const close = useEdgeTabStore((s) => s.close);

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
  const prefersReducedMotion = useReducedMotion();
  const { currentUser, company } = useAuthStore();

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
   *
   * Capture runs only on the OPEN transition — not on close — so toggling
   * closed doesn't burn a second screenshot.
   */
  const captureScreenshot = useCallback(async () => {
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
          // Skip the bug report tab/panel itself and anything that opts out
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
    }
  }, []);

  const handleToggle = useCallback(() => {
    // If we're about to OPEN the panel, capture the screenshot first so the
    // panel itself isn't in frame.
    if (!open) {
      void captureScreenshot();
    }
    toggle(EDGE_TAB_ID);
  }, [open, toggle, captureScreenshot]);

  // Close on Escape — duplicates the EdgeTab behavior but adds form reset.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (formState === "submitting") return;
        close(EDGE_TAB_ID);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, formState, close]);

  // Reset form a beat after closing so the exit animation has time to play.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setTitle("");
      setDescription("");
      setCategory("bug");
      setSeverity(null);
      setRequiresMyInput(false);
      setFormState("idle");
      setErrorMessage(null);
      setScreenshotBlob(null);
      setIncludeScreenshot(true);
    }, 220);
    return () => clearTimeout(t);
  }, [open]);

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
        close(EDGE_TAB_ID);
      }, 1200);
    } catch (err) {
      console.error("Bug report submission failed:", err);
      setFormState("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to submit bug report."
      );
    }
  }, [title, description, category, severity, requiresMyInput, formState, currentUser, company, screenshotBlob, includeScreenshot, close]);

  // Don't render on dashboard (map filter rail occupies bottom-left)
  // Don't render on intel (full-bleed canvas, overlaps cluster legend)
  if (pathname === "/dashboard" || pathname === "/intel") return null;

  return (
    <>
      {/* Right-rail edge tab — icon only at rest, "BUG REPORT" wordmark on
          hover/open. Mirrors NotificationsTab + QuickActionsTab. */}
      <EdgeTab
        id={EDGE_TAB_ID}
        open={open}
        onToggle={handleToggle}
        accent="ambient"
        restHeight={REST_HEIGHT_BUG}
        expandedHeight={PANEL_H}
        drawerWidth={PANEL_W}
        stackOffset={STACK_OFFSET_BUG}
        canHoverExpand={!anyActive || open}
        wordmark={t("bugReport.label")}
        wordmarkOpen="CLOSE"
        ariaLabel={t("bugReport.title")}
        tooltipTitle={t("bugReport.title")}
        renderGlyph={(isOpen) =>
          capturingScreenshot ? (
            <Loader2 className="w-[14px] h-[14px] animate-spin" />
          ) : isOpen ? (
            <X className="w-[14px] h-[14px]" />
          ) : (
            <Bug className="w-[14px] h-[14px]" />
          )
        }
      />

      {/* Panel-anchored drawer — same geometry as Quick Actions so the
          tab + panel read as one shape (308×420 centered on stackOffset). */}
      <AnimatePresence mode="wait">
        {open && (
          <div
            data-bug-report-ignore="true"
            aria-hidden={false}
            style={{
              position: "fixed",
              top: RAIL_TOP,
              right: 0,
              bottom: RAIL_BOTTOM,
              width: PANEL_W,
              pointerEvents: "none",
              zIndex: 1500,
            }}
          >
            <motion.div
              key="bug-report-panel"
              initial={prefersReducedMotion ? { opacity: 0 } : { x: PANEL_W, opacity: 0 }}
              animate={prefersReducedMotion ? { opacity: 1 } : { x: 0, opacity: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { x: PANEL_W, opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0.15 : 0.26, ease: [0.22, 1, 0.36, 1] }}
              role="dialog"
              aria-label={t("bugReport.title")}
              data-edge-tab-drawer="bug-report"
              style={{
                position: "absolute",
                top: `calc(50% + ${STACK_OFFSET_BUG - PANEL_H / 2}px)`,
                right: 0,
                width: PANEL_W,
                height: PANEL_H,
                background: "var(--glass)",
                backdropFilter: "blur(28px) saturate(1.3)",
                WebkitBackdropFilter: "blur(28px) saturate(1.3)",
                border: "1px solid var(--glass-border)",
                borderRight: "none",
                borderRadius: "10px 0 0 10px",
                pointerEvents: "auto",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-[rgba(255,255,255,0.08)]">
                <span className="font-mono text-micro uppercase tracking-wider text-text-2">
                  {t("bugReport.title")}
                </span>
                <button
                  onClick={() => close(EDGE_TAB_ID)}
                  className="p-1 text-text-mute hover:text-text-2 transition-colors duration-150"
                  aria-label="Close"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto scrollbar-hide p-3 space-y-2.5">
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
                      <label
                        className={cn(
                          "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-[4px] border transition-colors cursor-pointer",
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
                        <Switch
                          checked={requiresMyInput}
                          onCheckedChange={setRequiresMyInput}
                        />
                      </label>
                    )}

                    <div className="space-y-1.5">
                      <p className="font-mono text-micro text-text-mute tracking-wider">
                        {t("bugReport.autoCapture")}
                      </p>
                      {isPowerUser && screenshotBlob && (
                        <label
                          className={cn(
                            "w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-sm border transition-colors cursor-pointer",
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
                          <Switch
                            checked={includeScreenshot}
                            onCheckedChange={setIncludeScreenshot}
                          />
                        </label>
                      )}
                    </div>

                    {formState === "error" && errorMessage && (
                      <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-sm border border-[rgba(220,80,80,0.3)] bg-[rgba(220,80,80,0.08)]">
                        <AlertCircle className="w-3 h-3 text-[#E57373] mt-[2px] flex-shrink-0" />
                        <p className="font-mono text-micro tracking-wider text-[#E57373] break-words">
                          {errorMessage}
                        </p>
                      </div>
                    )}

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
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
