"use client";

/**
 * Refund-request form. Single textarea + submit. The server route
 * recomputes eligibility — this component does NOT trust client-side
 * inputs for any field beyond the reason text. Validation here is
 * UX-only; the API is the source of truth.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";

const MIN_LENGTH = 50;
const MAX_LENGTH = 2000;

type Submission =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "submitted"; requestId: string }
  | { kind: "error"; message: string };

export function RefundRequestForm({
  projectId,
  backHref,
  hasOpenGuarantee,
}: {
  projectId: string;
  backHref: string;
  hasOpenGuarantee: boolean;
}) {
  const [reason, setReason] = useState("");
  const [submission, setSubmission] = useState<Submission>({ kind: "idle" });
  const [, startTransition] = useTransition();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);

  const length = reason.length;
  const remaining = MAX_LENGTH - length;
  const lengthValid = length >= MIN_LENGTH && length <= MAX_LENGTH;
  const disabled =
    hasOpenGuarantee ||
    !lengthValid ||
    submission.kind === "submitting" ||
    submission.kind === "submitted";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;

    setSubmission({ kind: "submitting" });

    try {
      const res = await fetch(
        `/api/account/spec/${projectId}/request-refund`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
          body: JSON.stringify({ reason_text: reason }),
        }
      );

      const payload = (await res.json().catch(() => ({}))) as {
        request_id?: string;
        error?: string;
      };

      if (!res.ok) {
        setSubmission({
          kind: "error",
          message:
            payload.error ??
            (res.status === 409
              ? "A guarantee refund request is already open for this engagement."
              : res.status === 422
                ? "Please add more detail — between 50 and 2000 characters."
                : "We couldn't file your request. Try again or reach out directly."),
        });
        return;
      }

      if (!payload.request_id) {
        setSubmission({
          kind: "error",
          message:
            "We filed your request but couldn't confirm the receipt. Reach out directly to verify.",
        });
        return;
      }

      setSubmission({ kind: "submitted", requestId: payload.request_id });
      startTransition(() => router.refresh());
    } catch (err) {
      setSubmission({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "Network error. Try again in a moment.",
      });
    }
  }

  if (submission.kind === "submitted") {
    return (
      <div className="glass-surface px-5 py-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-3 mb-3">
          {"// FILED"}
        </p>
        <p className="font-mohave font-light text-[15px] leading-relaxed text-text">
          Your request is in. We will reach out within 1 business day.
        </p>
        <p className="mt-2 font-mono text-[11px] tabular-nums text-text-3">
          [request ID :: {submission.requestId}]
        </p>
        <div className="mt-6">
          <Link
            href={backHref}
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-ops-accent hover:underline"
          >
            Back to engagement
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="reason-text"
          className="block font-mohave font-light text-[14px] text-text mb-2"
        >
          Tell us why you are requesting a refund.
        </label>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-3 mb-2">
          [required • 50 — 2000 characters]
        </p>
        <textarea
          id="reason-text"
          name="reason_text"
          value={reason}
          onChange={(event) => setReason(event.target.value.slice(0, MAX_LENGTH))}
          minLength={MIN_LENGTH}
          maxLength={MAX_LENGTH}
          required
          disabled={hasOpenGuarantee}
          rows={8}
          placeholder="What didn't work? Where did we miss the mark?"
          className="ops-input min-h-[180px] resize-y font-mohave text-[14px] leading-relaxed disabled:opacity-50"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-3">
            {length < MIN_LENGTH
              ? `${MIN_LENGTH - length} more characters required`
              : `${remaining} characters remaining`}
          </p>
          <p className="font-mono text-[10px] tabular-nums text-text-3">
            {length} / {MAX_LENGTH}
          </p>
        </div>
      </div>

      {submission.kind === "error" && (
        <div className="px-3 py-2 border-l-2 border-l-ops-error">
          <p className="font-mono text-[11px] tracking-wide text-text">
            {submission.message}
          </p>
        </div>
      )}

      <p className="font-mohave font-light text-[12px] leading-relaxed text-text-3">
        We process valid Guarantee Refunds within 7 business days. Outside the
        30-day window we review at our discretion.
      </p>

      <div className="flex items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={disabled}
          className="font-mono text-[11px] uppercase tracking-[0.18em] px-4 py-2 rounded-[5px] border border-ops-accent text-ops-accent transition-colors duration-150 hover:bg-ops-accent hover:text-black focus:outline-none focus-visible:outline focus-visible:outline-1.5 focus-visible:outline-offset-2 focus-visible:outline-ops-accent disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ops-accent disabled:cursor-not-allowed"
        >
          {submission.kind === "submitting"
            ? "Filing…"
            : "Submit refund request"}
        </button>
        <Link
          href={backHref}
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-3 hover:text-text"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
