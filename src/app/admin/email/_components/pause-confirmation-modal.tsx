"use client";

/**
 * PauseConfirmationModal — operator must enter a reason (>= 3 chars) and
 * pick an auto-resume duration (Indefinite / 1h / 24h) before a pause is
 * applied. Mounted at z-3000 (modal layer).
 *
 * Visual spec:
 *   - .glass-dense surface (rgba(18,18,20,0.78) + backdrop-blur(28px)).
 *   - destructive button outlined in brick #93321A — red is reserved for
 *     hard errors but borderless brick on the action button reads as
 *     "this is a deliberate destructive thing", which is what a pause is.
 */
import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { confirmationModalVariants } from "@/lib/utils/motion";

interface PauseConfirmationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string, pausedUntil: string | null) => Promise<void>;
  scopeLabel: string;
}

type Duration = "forever" | "1h" | "24h";

export function PauseConfirmationModal({
  open,
  onClose,
  onConfirm,
  scopeLabel,
}: PauseConfirmationModalProps) {
  const reduced = useReducedMotion();
  const [reason, setReason] = React.useState("");
  const [duration, setDuration] = React.useState<Duration>("forever");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset state every time the modal opens for a new scope.
  React.useEffect(() => {
    if (open) {
      setReason("");
      setDuration("forever");
      setError(null);
      setSubmitting(false);
    }
  }, [open, scopeLabel]);

  if (!open) return null;

  const submit = async () => {
    if (reason.trim().length < 3) {
      setError("Reason must be at least 3 characters.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const pausedUntil =
      duration === "1h"
        ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
        : duration === "24h"
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : null;
    try {
      await onConfirm(reason, pausedUntil);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pause failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ zIndex: 3000, background: "rgba(0,0,0,0.7)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-confirmation-title"
    >
      <motion.div
        variants={reduced ? undefined : confirmationModalVariants}
        initial={reduced ? false : "initial"}
        animate={reduced ? false : "animate"}
        className="w-full max-w-[480px] border border-[#93321A]/40 px-6 py-6"
        style={{
          background: "rgba(18,18,20,0.78)",
          backdropFilter: "blur(28px) saturate(1.3)",
          WebkitBackdropFilter: "blur(28px) saturate(1.3)",
          borderRadius: 12,
        }}
      >
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#C4A868]">
          {"// CONFIRM PAUSE"}
        </div>
        <h2
          id="pause-confirmation-title"
          className="mt-3 font-cakemono font-light text-[22px] uppercase text-[#EDEDED]"
        >
          Pause {scopeLabel}?
        </h2>
        <p className="mt-3 font-mohave text-[14px] text-[#B5B5B5]">
          This stops every matching send until you resume. In-flight campaign jobs
          stay queued and resume automatically when you lift the pause.
        </p>

        <label className="mt-6 block font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
          {"// REASON"}
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. SendGrid 5xx storm at 14:32 UTC"
          className="mt-2 w-full bg-transparent border border-white/[0.09] px-3 py-2 font-mohave text-[14px] text-[#EDEDED] placeholder:text-[#6A6A6A] focus:outline-none focus:border-[#6F94B0]"
          style={{ borderRadius: 5 }}
          autoFocus
        />

        <label className="mt-5 block font-mono text-[11px] uppercase tracking-[0.16em] text-[#8A8A8A]">
          {"// AUTO-RESUME"}
        </label>
        <div className="mt-2 flex gap-2">
          {(["forever", "1h", "24h"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDuration(d)}
              className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] border transition-colors ${
                duration === d
                  ? "border-[#6F94B0] text-[#6F94B0]"
                  : "border-white/[0.09] text-[#8A8A8A] hover:text-[#EDEDED]"
              }`}
              style={{ borderRadius: 5 }}
            >
              {d === "forever" ? "Indefinite" : `In ${d}`}
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-4 font-mono text-[11px] text-[#B58289]">
            [{error}]
          </div>
        )}

        <div className="mt-8 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-5 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#B5B5B5] hover:text-[#EDEDED] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || reason.trim().length < 3}
            className="px-5 py-2 border border-[#93321A] text-[#EDEDED] font-mono text-[11px] uppercase tracking-[0.16em] hover:bg-[#93321A] disabled:opacity-40"
            style={{ borderRadius: 5 }}
          >
            {submitting ? "PAUSING…" : "PAUSE"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
