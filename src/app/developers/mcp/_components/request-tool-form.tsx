"use client";

import { useId, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import type { McpDocsCopy } from "@/lib/agent-control-plane/mcp/docs/copy";
import { cn } from "@/lib/utils/cn";

const REQUEST_ENDPOINT = "/api/developers/mcp/tool-requests";
const EMAIL_MAX_LENGTH = 254;
const DETAILS_MIN_LENGTH = 20;
const DETAILS_MAX_LENGTH = 4_000;
const REQUEST_TIMEOUT_MS = 15_000;

interface RequestToolFormProps {
  readonly copy: McpDocsCopy;
  readonly className?: string;
}

interface FieldErrors {
  email?: string;
  details?: string;
}

type SubmissionState = "idle" | "submitting" | "success" | "error";

function normalizeDetails(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function hasMatchingSuccessResponse(
  response: Response,
  submissionId: string
): Promise<boolean> {
  if (!response.ok) return false;
  try {
    const payload = (await response.json()) as unknown;
    return (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      (payload as Record<string, unknown>).ok === true &&
      (payload as Record<string, unknown>).submissionId === submissionId &&
      typeof (payload as Record<string, unknown>).replayed === "boolean"
    );
  } catch {
    return false;
  }
}

export function RequestToolForm({ copy, className }: RequestToolFormProps) {
  const fieldIdPrefix = useId();
  const submissionId = useRef<string | null>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const detailsInput = useRef<HTMLTextAreaElement>(null);
  const [email, setEmail] = useState("");
  const [details, setDetails] = useState("");
  const [website, setWebsite] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submissionState, setSubmissionState] =
    useState<SubmissionState>("idle");
  const [submissionError, setSubmissionError] = useState("");

  const emailId = `${fieldIdPrefix}-email`;
  const emailErrorId = `${emailId}-error`;
  const detailsId = `${fieldIdPrefix}-details`;
  const detailsHelpId = `${detailsId}-help`;
  const detailsSafetyId = `${detailsId}-safety`;
  const detailsErrorId = `${detailsId}-error`;
  const isSubmitting = submissionState === "submitting";

  function resetFailedSubmission() {
    submissionId.current = null;
    setSubmissionError("");
    setSubmissionState((current) => (current === "error" ? "idle" : current));
  }

  function validate(normalizedEmail: string, normalizedDetails: string) {
    const nextErrors: FieldErrors = {};

    if (!normalizedEmail) {
      nextErrors.email = copy.requestToolEmailRequired;
    } else if (
      normalizedEmail.length > EMAIL_MAX_LENGTH ||
      !isValidEmail(normalizedEmail)
    ) {
      nextErrors.email = copy.requestToolEmailInvalid;
    }

    const detailsLength = Array.from(normalizedDetails).length;
    if (detailsLength < DETAILS_MIN_LENGTH) {
      nextErrors.details = copy.requestToolDetailsInvalid;
    } else if (detailsLength > DETAILS_MAX_LENGTH) {
      nextErrors.details = copy.requestToolDetailsTooLong;
    }

    setFieldErrors(nextErrors);
    return nextErrors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedDetails = normalizeDetails(details);
    const nextErrors = validate(normalizedEmail, normalizedDetails);
    if (Object.keys(nextErrors).length > 0) {
      (nextErrors.email ? emailInput : detailsInput).current?.focus();
      return;
    }

    const stableSubmissionId =
      submissionId.current ?? globalThis.crypto.randomUUID();
    submissionId.current = stableSubmissionId;
    setSubmissionError("");
    setSubmissionState("submitting");
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

    try {
      const response = await fetch(REQUEST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          submissionId: stableSubmissionId,
          email: normalizedEmail,
          details: normalizedDetails,
          website,
        }),
      });

      if (await hasMatchingSuccessResponse(response, stableSubmissionId)) {
        setSubmissionState("success");
        return;
      }

      setSubmissionError(
        response.status === 429
          ? copy.requestToolRateLimited
          : copy.requestToolError
      );
      setSubmissionState("error");
    } catch {
      setSubmissionError(copy.requestToolError);
      setSubmissionState("error");
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  if (submissionState === "success") {
    return (
      <Surface
        className={cn("p-3 transition-none", className)}
        role="status"
        aria-live="polite"
      >
        <p className="font-cakemono text-cake-button uppercase text-text">
          {copy.requestToolSuccessTitle}
        </p>
        <p className="mt-1 font-mohave text-body-sm text-text-2">
          {copy.requestToolSuccessBody}
        </p>
      </Surface>
    );
  }

  return (
    <Surface className={cn("p-3 transition-none", className)}>
      <form
        aria-label={copy.requestToolTitle}
        aria-busy={isSubmitting || undefined}
        action={REQUEST_ENDPOINT}
        method="post"
        noValidate
        onSubmit={handleSubmit}
      >
        <div>
          <label
            htmlFor={emailId}
            className="block font-cakemono text-cake-badge uppercase text-text-2"
          >
            {copy.requestToolEmailFieldLabel}
          </label>
          <input
            ref={emailInput}
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={EMAIL_MAX_LENGTH}
            value={email}
            disabled={isSubmitting}
            aria-invalid={fieldErrors.email ? "true" : undefined}
            aria-describedby={fieldErrors.email ? emailErrorId : undefined}
            aria-errormessage={fieldErrors.email ? emailErrorId : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
              setFieldErrors((current) => ({
                ...current,
                email: undefined,
              }));
              resetFailedSubmission();
            }}
            className={cn(
              "mt-0.5 min-h-control-40 w-full rounded border bg-surface-input px-1.5 py-1 font-mohave text-body text-text outline-none transition-colors duration-150 ease-smooth focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
              fieldErrors.email
                ? "border-rose-line focus:border-rose"
                : "border-line focus:border-line-hi"
            )}
          />
          {fieldErrors.email ? (
            <p
              id={emailErrorId}
              className="mt-0.5 font-mono text-micro text-rose"
              role="alert"
            >
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div className="mt-2">
          <label
            htmlFor={detailsId}
            className="block font-cakemono text-cake-badge uppercase text-text-2"
          >
            {copy.requestToolDetailsLabel}
          </label>
          <textarea
            ref={detailsInput}
            id={detailsId}
            name="details"
            rows={5}
            required
            minLength={DETAILS_MIN_LENGTH}
            maxLength={DETAILS_MAX_LENGTH}
            value={details}
            disabled={isSubmitting}
            aria-invalid={fieldErrors.details ? "true" : undefined}
            aria-errormessage={fieldErrors.details ? detailsErrorId : undefined}
            aria-describedby={[
              detailsHelpId,
              detailsSafetyId,
              fieldErrors.details ? detailsErrorId : null,
            ]
              .filter(Boolean)
              .join(" ")}
            onChange={(event) => {
              setDetails(event.target.value);
              setFieldErrors((current) => ({
                ...current,
                details: undefined,
              }));
              resetFailedSubmission();
            }}
            className={cn(
              "mt-0.5 min-h-control-40 w-full resize-y rounded border bg-surface-input px-1.5 py-1 font-mohave text-body text-text outline-none transition-colors duration-150 ease-smooth focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
              fieldErrors.details
                ? "border-rose-line focus:border-rose"
                : "border-line focus:border-line-hi"
            )}
          />
          <p
            id={detailsHelpId}
            className="mt-0.5 font-mohave text-body-sm text-text-3"
          >
            {copy.requestToolDetailsHelp}
          </p>
          {fieldErrors.details ? (
            <p
              id={detailsErrorId}
              className="mt-0.5 font-mono text-micro text-rose"
              role="alert"
            >
              {fieldErrors.details}
            </p>
          ) : null}
          <p
            id={detailsSafetyId}
            className="mt-1 font-mono text-micro uppercase tracking-wider text-text-3"
          >
            {copy.requestToolSafety}
          </p>
        </div>

        <input
          name="website"
          type="text"
          value={website}
          autoComplete="off"
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(event) => {
            setWebsite(event.target.value);
            resetFailedSubmission();
          }}
        />

        {submissionError ? (
          <div
            className="mt-2 rounded border border-rose-line bg-rose-soft p-1.5"
            role="alert"
          >
            <p className="font-mohave text-body-sm text-rose">
              {submissionError}
            </p>
          </div>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          disabled={isSubmitting}
          aria-busy={isSubmitting || undefined}
          className="mt-2"
        >
          {isSubmitting ? copy.requestToolSubmitting : copy.requestToolSubmit}
        </Button>
      </form>
    </Surface>
  );
}
