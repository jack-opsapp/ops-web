"use client";

/**
 * OPS Web — Lead discard capture toast (Phase C).
 *
 * ONE surface does two jobs: it is the undo toast for a discard that already
 * happened optimistically, AND the one-tap reason rack that turns that discard
 * into training evidence. The operator never opens a dialog, never picks from
 * a select, and never has to care — ignoring the toast simply commits the
 * plain discard. Tapping a chip is the whole interaction.
 *
 * Rendering contract (verified against sonner 1.7.4):
 *   - `toast.custom` still receives the toaster-level `toastOptions.classNames`
 *     (`className: cn(…, s?.toast, t.classNames?.toast, …)` in sonner's Toast
 *     component), so the outer `<li>` ALREADY is the glass-dense 340px,
 *     12px-radius, hairline-bordered, shadow-free OPS toast surface with the
 *     14/12/10 padding from `.ops-toast` in globals.css. This body therefore
 *     renders the CONTENT COLUMN ONLY — a second glass shell would stack glass
 *     on glass (banned, DESIGN.md §5) and overflow the fixed 340px width.
 *   - A custom toast cannot carry `data-type` (sonner's `ExternalToast` omits
 *     it), so the olive "asserted" rail is opted into by the
 *     `ops-toast-discard-capture` class instead. Same token as `toast.success`.
 *   - Sonner MERGES an update payload onto the existing toast, so the pending
 *     phase's `onDismiss`/`onAutoClose` survive into the confirmed phase. The
 *     single-fire `settled` guard below is what keeps a confirmed toast's
 *     eventual close from also committing the plain discard.
 *   - Sonner re-measures a toast's height in a layout effect keyed on
 *     `[mounted, title, description, …]` — deliberately NOT on `jsx`. A custom
 *     toast that swaps its content therefore keeps the height it mounted with,
 *     which left ~109px of empty glass under the one-line confirmed state (the
 *     rack is nine chips tall, the confirmation is one tag). Two things are
 *     needed to make that measurement land correctly, and BOTH are load-bearing:
 *
 *       1. A phase-varying `description` re-arms the effect. It must be
 *          `description`, NOT `title`: sonner's update path rebuilds the toast
 *          as `{...prev, ...data, title: data.message}`, so any `title` we pass
 *          is clobbered to undefined on every update. `description` survives.
 *          Neither is ever rendered here — the same component picks `t.jsx`
 *          over the title/description layout whenever jsx is present — so this
 *          is measurement metadata only. See {@link phaseMeasurementKey}.
 *       2. The phase swap must NOT animate out. Sonner measures synchronously
 *          in a layout effect, and `AnimatePresence mode="wait"` keeps the
 *          OUTGOING rack mounted on exactly that commit — so the re-measure
 *          would capture the tall state it is meant to replace. The confirmed
 *          block therefore mounts directly (enter-only motion): the rack is
 *          gone from the DOM before sonner measures.
 */

import { motion, useReducedMotion } from "framer-motion";
import { toast } from "@/components/ui/toast";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils/cn";
import {
  discardReasonSwapReducedVariants,
  discardReasonSwapVariants,
} from "@/lib/utils/motion";
import type { LeadDiscardReasonCode } from "@/lib/api/services/lead-disposition-feedback-service";

/** Same window as the shared undo toast — the discard stays reversible for 10s. */
const DISCARD_CAPTURE_DURATION_MS = 10_000;

/** Marks the toast so globals.css can paint its rail olive (see file header). */
const DISCARD_CAPTURE_TOAST_CLASS = "ops-toast-discard-capture";

/**
 * Sonner's height re-measure key (see file header). Passed as `description`,
 * never rendered — `jsx` always wins — so the toast box shrinks to the
 * confirmed state instead of holding the nine-chip rack's height.
 */
function phaseMeasurementKey(phase: DiscardFeedbackToastState["kind"]): string {
  return `discard-capture:${phase}`;
}

/** Dictionary accessor shape — matches `useDictionary(...).t`. */
export type DiscardFeedbackTranslate = (
  key: string,
  fallback?: string
) => string;

/**
 * Chip order is frequency, not the enum: what operators actually discard, most
 * often first. All nine stay visible — an expander would cost a second tap on
 * the only interaction this feature has.
 */
export const DISCARD_REASON_ORDER: readonly LeadDiscardReasonCode[] = [
  "spam",
  "vendor_sales",
  "job_applicant",
  "platform_notification",
  "internal",
  "test_traffic",
  "duplicate",
  "not_a_fit",
  "other",
];

export const DISCARD_REASON_DICT_KEYS: Record<LeadDiscardReasonCode, string> = {
  spam: "discardFeedback.reason.spam",
  vendor_sales: "discardFeedback.reason.vendorSales",
  job_applicant: "discardFeedback.reason.jobApplicant",
  platform_notification: "discardFeedback.reason.platformNotification",
  internal: "discardFeedback.reason.internal",
  test_traffic: "discardFeedback.reason.testTraffic",
  duplicate: "discardFeedback.reason.duplicate",
  not_a_fit: "discardFeedback.reason.notAFit",
  other: "discardFeedback.reason.other",
};

/** English fallbacks, so a dictionary that hasn't loaded still reads right. */
export const DISCARD_REASON_FALLBACK_LABELS: Record<
  LeadDiscardReasonCode,
  string
> = {
  spam: "Spam",
  vendor_sales: "Sales pitch",
  job_applicant: "Applicant",
  platform_notification: "Platform mail",
  internal: "Internal",
  test_traffic: "Test",
  duplicate: "Duplicate",
  not_a_fit: "Not a fit",
  other: "Other",
};

/** Localized chip/tag label for a reason. Shared with the discard controller. */
export function discardReasonLabel(
  t: DiscardFeedbackTranslate,
  code: LeadDiscardReasonCode
): string {
  return t(DISCARD_REASON_DICT_KEYS[code], DISCARD_REASON_FALLBACK_LABELS[code]);
}

export type DiscardFeedbackToastState =
  | { kind: "pending" }
  | { kind: "confirmed"; reasonLabel: string };

export interface DiscardFeedbackToastBodyProps {
  /** `${clientName}` or `${clientName} · ${value}` — pre-formatted by caller. */
  title: string;
  /** `FROM → TO` while pending; the outcome line once confirmed. */
  stateLine: string;
  t: DiscardFeedbackTranslate;
  state: DiscardFeedbackToastState;
  /** True while the apply RPC is in flight — the rack locks, no spinner. */
  applying: boolean;
  onReason: (code: LeadDiscardReasonCode) => void;
  onUndo: () => void;
}

/** The `//` prefix globals.css prepends to every other toast description. */
function SlashPrefix() {
  return <span className="text-text-mute">{"// "}</span>;
}

export function DiscardFeedbackToastBody({
  title,
  stateLine,
  t,
  state,
  applying,
  onReason,
  onUndo,
}: DiscardFeedbackToastBodyProps) {
  const reduced = useReducedMotion();
  const swapVariants = reduced
    ? discardReasonSwapReducedVariants
    : discardReasonSwapVariants;

  return (
    // pl-2 mirrors `[data-sonner-toast].ops-toast [data-content]` so the
    // content column sits on the same rhythm as every other OPS toast.
    <div className="relative w-full min-w-0 pl-2">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate font-mohave text-[12px] font-medium uppercase leading-[1.1] tracking-[0.08em] text-text">
          {title}
        </span>
        <button
          type="button"
          onClick={onUndo}
          className={cn(
            "shrink-0 rounded border border-ops-accent bg-transparent px-2 py-[3px]",
            "font-mohave text-[11px] uppercase tracking-[0.12em] text-ops-accent",
            "transition-colors duration-150 hover:bg-ops-accent hover:text-black",
            "focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent"
          )}
        >
          {t("discardFeedback.undo", "Undo")}
        </button>
      </div>

      <p className="mt-1 font-mono text-[11px] leading-[1.35] tracking-[0.02em] text-text-3">
        <SlashPrefix />
        {stateLine}
      </p>

      {/* Enter-only motion, deliberately no AnimatePresence — see file header
       * point 2: an exiting rack would still be mounted when sonner measures. */}
      <div className="mt-2.5 border-t border-line pt-2">
        {state.kind === "pending" ? (
          <motion.div
            key="pending"
            variants={swapVariants}
            initial="hidden"
            animate="visible"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
              <SlashPrefix />
              {t("discardFeedback.reasonHeading", "Reason — trains the filter")}
            </p>
            <div
              role="group"
              aria-label={t("discardFeedback.reasonGroupAria", "Discard reason")}
              className="mt-1.5 flex flex-wrap gap-1.5"
            >
              {DISCARD_REASON_ORDER.map((code) => (
                <button
                  key={code}
                  type="button"
                  disabled={applying}
                  onClick={() => onReason(code)}
                  className={cn(
                    "rounded-chip border border-line bg-surface-hover px-1.5 py-[3px]",
                    "font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-2",
                    "transition-colors duration-150",
                    "hover:border-line-hi hover:bg-surface-active hover:text-text",
                    "focus-visible:outline focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-ops-accent",
                    applying && "pointer-events-none opacity-60"
                  )}
                >
                  {discardReasonLabel(t, code)}
                </button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="confirmed"
            variants={swapVariants}
            initial="hidden"
            animate="visible"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
              <SlashPrefix />
              {t("discardFeedback.logged", "Reason logged")}
            </p>
            <div className="mt-1.5">
              <Tag variant="olive">{state.reasonLabel}</Tag>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

export interface DiscardFeedbackToastHandle {
  toastId: string | number;
  /**
   * Marks the capture resolved. Once settled, a later close of this toast can
   * never fire `onClosedWithoutReason` — a confirmed discard must not also
   * commit the plain move.
   */
  settle: () => void;
}

export interface ShowDiscardFeedbackToastOptions {
  title: string;
  stateLine: string;
  t: DiscardFeedbackTranslate;
  onReason: (code: LeadDiscardReasonCode) => void;
  /** Pending-phase undo: nothing was written yet, so this is a cancel. */
  onUndo: () => void;
  /** Auto-close AND manual dismiss — fires at most once. */
  onClosedWithoutReason: () => void;
  durationMs?: number;
}

export interface ConfirmDiscardFeedbackToastOptions {
  title: string;
  stateLine: string;
  reasonLabel: string;
  t: DiscardFeedbackTranslate;
  /** Confirmed-phase undo: routes through the undo RPC. */
  onUndo: () => void;
  durationMs?: number;
}

/**
 * Open the capture toast. Returns the handle the controller uses to confirm or
 * dismiss it. The toast owns its own presentation state — tapping a chip locks
 * the rack immediately, before the caller's RPC even starts.
 */
export function showDiscardFeedbackToast(
  options: ShowDiscardFeedbackToastOptions
): DiscardFeedbackToastHandle {
  const duration = options.durationMs ?? DISCARD_CAPTURE_DURATION_MS;

  // One mutable cell for the toast's whole life: the id is needed by the
  // re-render that locks the rack, and `settled` is the guard every exit path
  // checks. `applying` lives here too so the swap needs no React state.
  const live: {
    toastId: string | number | undefined;
    settled: boolean;
    applying: boolean;
  } = { toastId: undefined, settled: false, applying: false };

  const settle = () => {
    live.settled = true;
  };

  const renderPending = () =>
    toast.custom(
      () => (
        <DiscardFeedbackToastBody
          title={options.title}
          stateLine={options.stateLine}
          t={options.t}
          state={{ kind: "pending" }}
          applying={live.applying}
          onReason={handleReason}
          onUndo={handleUndo}
        />
      ),
      {
        ...(live.toastId === undefined ? {} : { id: live.toastId }),
        duration,
        className: DISCARD_CAPTURE_TOAST_CLASS,
        description: phaseMeasurementKey("pending"),
        onDismiss: handleClosed,
        onAutoClose: handleClosed,
      }
    );

  function handleReason(code: LeadDiscardReasonCode) {
    if (live.settled) return;
    live.settled = true;
    live.applying = true;
    renderPending();
    options.onReason(code);
  }

  function handleUndo() {
    if (live.settled) return;
    live.settled = true;
    options.onUndo();
  }

  function handleClosed() {
    if (live.settled) return;
    live.settled = true;
    options.onClosedWithoutReason();
  }

  live.toastId = renderPending();

  return { toastId: live.toastId, settle };
}

/**
 * Swap the same toast into its confirmed state with a fresh visibility window.
 * Sonner updates in place, so the reason rack animates out and the logged
 * reason lands without the toast ever leaving the screen.
 */
export function confirmDiscardFeedbackToast(
  handle: DiscardFeedbackToastHandle,
  options: ConfirmDiscardFeedbackToastOptions
): void {
  handle.settle();
  toast.custom(
    () => (
      <DiscardFeedbackToastBody
        title={options.title}
        stateLine={options.stateLine}
        t={options.t}
        state={{ kind: "confirmed", reasonLabel: options.reasonLabel }}
        applying={false}
        onReason={() => {}}
        onUndo={options.onUndo}
      />
    ),
    {
      id: handle.toastId,
      duration: options.durationMs ?? DISCARD_CAPTURE_DURATION_MS,
      className: DISCARD_CAPTURE_TOAST_CLASS,
      description: phaseMeasurementKey("confirmed"),
    }
  );
}

/**
 * Close the capture toast programmatically (error and undo paths). Settles
 * first so the close can never be mistaken for "the operator ignored it".
 */
export function dismissDiscardFeedbackToast(
  handle: DiscardFeedbackToastHandle
): void {
  handle.settle();
  toast.dismiss(handle.toastId);
}
