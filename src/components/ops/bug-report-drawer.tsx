"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Send, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { useBugReportStore } from "@/stores/bug-report-store";
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
import { Switch } from "@/components/ui/switch";
import { EDGE_TAB_ID_BUG, STACK_OFFSET_BUG } from "./bug-report-tab";

// ─── Drawer geometry ───────────────────────────────────────────────────────
// Mirrors quick-actions-drawer.tsx — panel-anchored 360×520 right-edge
// drawer. The expanded EdgeTab clamps to the same 520px so the tab + drawer
// read as one shape.
const PANEL_W = 360;
const PANEL_H = 520;
const RAIL_TOP = 72;
const RAIL_BOTTOM = 16;
const EASE_SMOOTH: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ─── Form types ────────────────────────────────────────────────────────────

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

const SEVERITY_TO_PRIORITY: Record<Severity, BugReportPriority> = {
  blocker: "urgent",
  major: "high",
  minor: "low",
};

// ─── Drawer ────────────────────────────────────────────────────────────────

/**
 * Bug-report drawer (bug b842f0ff) — replaces the legacy free-floating
 * `BugReportButton` with a right-edge EdgeTab + drawer pairing.
 *
 * Form behavior is unchanged from the legacy button:
 *   - Power user (canprojack@gmail.com) gets full triage controls
 *     (category / severity / requires-my-input / screenshot toggle).
 *   - Everyone else gets a single textarea + auto-attached screenshot.
 *   - Screenshot is captured BEFORE the drawer renders via the
 *     `useBugReportStore` token pattern, so the image shows what was
 *     on-screen when the operator triggered the report.
 *
 * Drawer chrome (background, border, slide-in animation) mirrors
 * `quick-actions-drawer.tsx` so all three right-rail drawers
 * (notifications / quick-actions / bug-report) read as one system.
 */
export function BugReportDrawer() {
  const { t } = useDictionary("common");
  const open = useEdgeTabStore((s) => s.activeTab === EDGE_TAB_ID_BUG);
  const close = useEdgeTabStore((s) => s.close);
  const reducedMotion = useReducedMotion();
  const { currentUser, company } = useAuthStore();
  const screenshotToken = useBugReportStore((s) => s.screenshotToken);

  // ── Form state ──
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
  const drawerRef = useRef<HTMLElement>(null);
  const lastCaptureToken = useRef<number>(-1);

  // Power-user gate — same as legacy. Trades-business-owner default is the
  // single-textarea form; power user (the developer) gets the full triage
  // UI. Defaults applied for hidden fields: category='bug', severity=null,
  // requiresHumanReview=false, screenshot=included.
  const isPowerUser = currentUser?.email === "canprojack@gmail.com";

  // Initialize the bug-context capture once on mount (URL, breadcrumbs,
  // console, etc.). Cheap idempotent — re-running just resets the buffer.
  useEffect(() => {
    initBugContext();
  }, []);

  // ── Screenshot capture ──
  //
  // Captures `document.body` to a PNG blob whenever:
  //   1. The drawer opens (token incremented by the tab on toggle), OR
  //   2. The user requests a fresh capture from inside the drawer.
  //
  // modern-screenshot is preferred over html2canvas — it handles backdrop-
  // filter and custom fonts correctly, both of which are pervasive in this
  // app's frosted-glass surfaces.
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
          // Skip the bug report drawer + tab itself and anything that opts out.
          if (node.dataset?.bugReportIgnore === "true") return false;
          if (node.dataset?.edgeTab === EDGE_TAB_ID_BUG) return false;
          return true;
        },
      });
      setScreenshotBlob(blob);
    } catch (err) {
      console.warn("Bug report screenshot capture failed:", err);
      setScreenshotBlob(null);
    } finally {
      setCapturingScreenshot(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (screenshotToken === lastCaptureToken.current) return;
    lastCaptureToken.current = screenshotToken;
    captureScreenshot();
  }, [open, screenshotToken, captureScreenshot]);

  // ── Outside-click dismiss ──
  // Mirrors notifications/quick-actions drawers (bug 5b653c30). Skip if the
  // click landed inside the drawer or on either tab in the rail.
  useEffect(() => {
    if (!open) return;
    if (formState === "submitting") return;

    function handleOutsideMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      const path = e.composedPath();

      if (drawerRef.current && drawerRef.current.contains(target)) return;
      if (drawerRef.current && path.includes(drawerRef.current)) return;

      for (const node of path) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.dataset?.edgeTab) return;
        if (node.dataset?.edgeTabDetached === "true") return;
        if (node.getAttribute?.("role") === "dialog") return;
      }

      close(EDGE_TAB_ID_BUG);
    }
    document.addEventListener("mousedown", handleOutsideMouseDown, true);
    return () =>
      document.removeEventListener("mousedown", handleOutsideMouseDown, true);
  }, [open, close, formState]);

  // ── Escape closes the drawer (unless submitting) ──
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (formState === "submitting") return;
      close(EDGE_TAB_ID_BUG);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close, formState]);

  // ── Reset form when the drawer closes ──
  // Done in an effect rather than a setTimeout so re-opening immediately
  // gives a clean form. The brief animation gap between close-trigger and
  // unmount is covered by AnimatePresence — the form below stays visible
  // through the fade-out.
  useEffect(() => {
    if (open) return;
    setTitle("");
    setDescription("");
    setCategory("bug");
    setSeverity(null);
    setRequiresMyInput(false);
    setFormState("idle");
    setErrorMessage(null);
    setScreenshotBlob(null);
    setIncludeScreenshot(true);
  }, [open]);

  // ── Submit ──
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
          submittedFrom: "bug-report-drawer",
        },
      });

      // bug_reports.description is NOT NULL — merge title + details so the
      // column is always populated, with the user's title as the lead line.
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
      // client-side storage writes fail the bug-reports bucket RLS:
      // ops-web's Supabase client uses a Firebase JWT which does not
      // produce the Postgres "authenticated" role required by the bucket's
      // INSERT policy.
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
        close(EDGE_TAB_ID_BUG);
      }, 1200);
    } catch (err) {
      console.error("Bug report submission failed:", err);
      setFormState("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to submit bug report."
      );
    }
  }, [
    title,
    description,
    category,
    severity,
    requiresMyInput,
    formState,
    currentUser,
    company,
    screenshotBlob,
    includeScreenshot,
    close,
  ]);

  const variants = reducedMotion
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.15 } },
        exit: { opacity: 0, transition: { duration: 0.15 } },
      }
    : {
        hidden: { x: PANEL_W, opacity: 0 },
        visible: {
          x: 0,
          opacity: 1,
          transition: { duration: 0.26, ease: EASE_SMOOTH },
        },
        exit: {
          x: PANEL_W,
          opacity: 0,
          transition: { duration: 0.22, ease: EASE_SMOOTH },
        },
      };

  // Width clamp — keeps the panel ≤ (viewport - 36px) on narrow screens so
  // the drawer never extends past the viewport edge (matches notifications /
  // quick-actions drawer behavior — bug edfdd057).
  const panelWidth = `min(${PANEL_W}px, calc(100vw - 36px))`;

  return (
    <AnimatePresence mode="wait">
      {open && (
        <div
          aria-hidden={false}
          data-bug-report-ignore="true"
          style={{
            position: "fixed",
            top: RAIL_TOP,
            right: 0,
            bottom: RAIL_BOTTOM,
            width: panelWidth,
            maxWidth: "calc(100vw - 36px)",
            pointerEvents: "none",
            zIndex: 1500,
          }}
        >
          <motion.aside
            ref={drawerRef}
            key="bug-report-drawer"
            variants={variants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="complementary"
            aria-label={t("bugReport.title") ?? "Report a bug"}
            data-bug-report-ignore="true"
            style={{
              position: "absolute",
              top: `calc(50% + ${STACK_OFFSET_BUG - PANEL_H / 2}px)`,
              right: 0,
              width: panelWidth,
              maxWidth: "calc(100vw - 36px)",
              height: PANEL_H,
              maxHeight: `calc(100vh - ${RAIL_TOP + RAIL_BOTTOM}px)`,
              display: "flex",
              flexDirection: "column",
              background: "rgba(32, 34, 38, 0.92)",
              backdropFilter: "blur(28px) saturate(1.3)",
              WebkitBackdropFilter: "blur(28px) saturate(1.3)",
              border: "1px solid rgba(255, 255, 255, 0.18)",
              borderRight: "none",
              pointerEvents: "auto",
              overflow: "hidden",
              boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.04)",
            }}
          >
            {/* Top-edge highlight gradient */}
            <span
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.04), transparent 40%)",
              }}
            />

            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "14px 16px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                position: "relative",
                zIndex: 1,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--text-mute)",
                  letterSpacing: "0.16em",
                }}
              >
                {"//"}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-cakemono)",
                  fontWeight: 300,
                  fontSize: 13,
                  color: "var(--text)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginLeft: 6,
                }}
              >
                {t("bugReport.title")}
              </span>
              <div style={{ flex: 1 }} />
              <span
                aria-hidden
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  color: "var(--text-2)",
                  letterSpacing: 0,
                  padding: "2px 6px",
                  minWidth: 16,
                  textAlign: "center",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 3,
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                `
              </span>
            </div>

            {/* Body — scrolls when the form overflows the panel */}
            <div
              className="hide-scrollbar"
              style={{
                flex: 1,
                overflowY: "auto",
                overflowX: "hidden",
                padding: "12px 14px 14px",
                position: "relative",
                zIndex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {formState === "success" ? (
                <div
                  className="flex flex-col items-center justify-center py-8 gap-2"
                  style={{ flex: 1 }}
                >
                  <CheckCircle2 className="w-5 h-5 text-ops-accent" />
                  <p className="font-mohave text-body-sm text-text-2 text-left">
                    {t("bugReport.submitted")}
                  </p>
                </div>
              ) : (
                <>
                  {isPowerUser && (
                    /* Category — required. Chip grid wraps to handle
                       longer localizations (e.g. Spanish "FEATURE REQUEST"). */
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

                  {/* Primary input — single textarea for minimal users
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
                        rows={5}
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
                    /* Severity — optional. Writes to `priority` as a hint;
                       admin can override during triage. Click active chip to
                       clear. */
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
                       agent skips this report. */
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

                  {/* Auto-captured context. Power user gets a screenshot
                      toggle; minimal users get the screenshot attached
                      silently. */}
                  <div className="space-y-1.5">
                    <p className="font-mono text-micro text-text-mute tracking-wider">
                      {t("bugReport.autoCapture")}
                      {capturingScreenshot && " · CAPTURING..."}
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
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
