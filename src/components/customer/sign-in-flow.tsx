"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useCustomerHosted } from "./customer-context";
import { CodeInput, CODE_LENGTH, type CodeInputHandle } from "./code-input";
import { StepMark } from "./step-mark";
import {
  startCustomerAuth,
  verifyCustomerAuth,
  DEFAULT_RETRY_AFTER_SECONDS,
  type StartFailure,
  type VerifyOutcome,
} from "./customer-api";
import {
  fillCopy,
  formatCountdown,
  isPlausibleEmail,
  safeCustomerNext,
  type CustomerCopy,
} from "@/lib/customer-identity/hosted-format";

type Step = "email" | "code";
type Phase = "idle" | "sending" | "verifying";

const TOTAL_STEPS = 2;

/** Remaining attempts are surfaced only once they are scarce (contract: ≤ 2). */
const ATTEMPTS_WARNING_THRESHOLD = 2;

function startFailureCopy(failure: StartFailure, copy: CustomerCopy): string {
  switch (failure.kind) {
    case "rate_limited":
      return failure.retryAfterSeconds !== null && failure.retryAfterSeconds > 0
        ? fillCopy(copy["error.rateLimited"], {
            time: formatCountdown(failure.retryAfterSeconds),
          })
        : copy["error.rateLimitedNoTime"];
    case "unknown_handle":
      return copy["notFound.body"];
    case "unavailable":
      return copy["error.unavailable"];
    case "offline":
      return copy["error.offline"];
    default:
      return copy["error.startFailed"];
  }
}

function verifyFailureCopy(
  failure: Extract<VerifyOutcome, { ok: false }>,
  copy: CustomerCopy
): string {
  switch (failure.kind) {
    case "invalid": {
      const left = failure.attemptsRemaining;
      if (left === null || left > ATTEMPTS_WARNING_THRESHOLD) return copy["error.codeInvalid"];
      // The broker reports 0 on the failure that exhausts the challenge.
      if (left === 0) return copy["error.codeExhausted"];
      if (left === 1) return copy["error.codeInvalidAttemptsOne"];
      return fillCopy(copy["error.codeInvalidAttemptsMany"], { n: left });
    }
    case "expired":
      return copy["error.codeExpired"];
    case "exhausted":
      return copy["error.codeExhausted"];
    case "unknown_handle":
      return copy["notFound.body"];
    case "unavailable":
      return copy["error.unavailable"];
    case "offline":
      return copy["error.offline"];
    default:
      return copy["error.verifyFailed"];
  }
}

/** A challenge the broker will never accept again: only a fresh code helps. */
function challengeIsDead(failure: Extract<VerifyOutcome, { ok: false }>): boolean {
  if (failure.kind === "exhausted" || failure.kind === "expired") return true;
  return failure.kind === "invalid" && failure.attemptsRemaining === 0;
}

/**
 * Email → six-digit code. Two steps, nothing else.
 *
 * Privacy: the flow never branches on whether an account exists (design
 * invariant I5). Every error string maps from a broker outcome; the broker
 * returns the same shape for known and unknown emails.
 */
export function SignInFlow() {
  const { handle, copy } = useCustomerHosted();
  const router = useRouter();

  const [step, setStep] = useState<Step>("email");
  const [phase, setPhase] = useState<Phase>("idle");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  /** Set when the broker has closed the challenge for good; the only way on is a new code. */
  const [challengeDead, setChallengeDead] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Resend gate: an absolute timestamp, so a backgrounded tab still counts down correctly.
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const codeInput = useRef<CodeInputHandle>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const ids = {
    email: useId(),
    emailError: useId(),
    codeError: useId(),
    notice: useId(),
  };

  const busy = phase !== "idle";
  const secondsLeft = resendAt === null ? 0 : Math.max(0, Math.ceil((resendAt - now) / 1000));
  const canResend = step === "code" && !busy && !challengeDead && secondsLeft === 0;

  useEffect(() => {
    if (resendAt === null) return;
    if (resendAt <= Date.now()) {
      setNow(Date.now());
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  const armResend = useCallback((seconds: number) => {
    const s = seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS;
    setResendAt(Date.now() + s * 1000);
    setNow(Date.now());
  }, []);

  // ── Step 1: email ──────────────────────────────────────────────────────

  /**
   * Ask the broker to send a code. `target` is the step whose error slot
   * receives a failure message (the email form, or the resend control on the
   * code step). Resolves true when a challenge was issued.
   */
  const sendCode = useCallback(
    async (address: string, target: Step): Promise<boolean> => {
      setPhase("sending");
      const outcome = await startCustomerAuth(handle, address);
      setPhase("idle");
      if (!outcome.ok) {
        if (outcome.kind === "rate_limited" && outcome.retryAfterSeconds) {
          armResend(outcome.retryAfterSeconds);
        }
        const message = startFailureCopy(outcome, copy);
        if (target === "code") setCodeError(message);
        else setEmailError(message);
        return false;
      }
      setChallengeId(outcome.challengeId);
      setChallengeDead(false);
      armResend(outcome.retryAfterSeconds);
      return true;
    },
    [handle, copy, armResend]
  );

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();
    if (!isPlausibleEmail(address)) {
      setEmailError(copy["error.emailInvalid"]);
      emailInput.current?.focus();
      return;
    }
    setEmailError(null);
    setEmail(address);
    const sent = await sendCode(address, "email");
    if (sent) {
      setCode("");
      setCodeError(null);
      setNotice(null);
      setStep("code");
    }
  }

  // ── Step 2: code ───────────────────────────────────────────────────────

  const verify = useCallback(
    async (candidate: string) => {
      if (!challengeId || challengeDead || candidate.length !== CODE_LENGTH) return;
      setPhase("verifying");
      setCodeError(null);
      setNotice(null);
      const outcome = await verifyCustomerAuth(handle, challengeId, candidate, email);
      if (outcome.ok) {
        // Stay disabled while the router moves; the page unmounts on arrival.
        router.replace(safeCustomerNext(outcome.next, handle));
        return;
      }
      setPhase("idle");
      setCode("");
      setCodeError(verifyFailureCopy(outcome, copy));
      if (challengeIsDead(outcome)) {
        setChallengeDead(true);
        return;
      }
      codeInput.current?.focusFirst();
    },
    [challengeId, challengeDead, handle, email, copy, router]
  );

  function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    void verify(code);
  }

  async function handleResend() {
    if (!canResend) return;
    setCodeError(null);
    setNotice(null);
    setCode("");
    const sent = await sendCode(email, "code");
    if (sent) {
      setNotice(copy["code.resent"]);
      codeInput.current?.focusFirst();
    }
  }

  /** Back to step one with the email kept, so one tap on SEND CODE issues a fresh challenge. */
  function returnToEmail() {
    if (busy) return;
    setStep("email");
    setChallengeId(null);
    setChallengeDead(false);
    setCode("");
    setCodeError(null);
    setNotice(null);
    setEmailError(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (step === "email") {
    return (
      <form
        key="email"
        onSubmit={handleEmailSubmit}
        noValidate
        className="cs-step-enter flex flex-col gap-3"
        aria-busy={busy || undefined}
      >
        <StepMark step={1} total={TOTAL_STEPS} label={copy["step.email"]} copy={copy} />

        <div className="flex flex-col gap-1">
          <h1 className="font-cakemono font-light text-cake-display uppercase tracking-widest cs-text leading-none">
            {copy["signin.title"]}
          </h1>
          <p className="font-mohave text-body cs-text-2">{copy["signin.lead"]}</p>
        </div>

        <div className="flex flex-col gap-0.5">
          <label
            htmlFor={ids.email}
            className="font-mono text-micro uppercase tracking-widest cs-text-2"
          >
            {copy["signin.emailLabel"]}
          </label>
          <input
            ref={emailInput}
            id={ids.email}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            autoFocus
            disabled={busy}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (emailError) setEmailError(null);
            }}
            placeholder={copy["signin.emailPlaceholder"]}
            aria-invalid={emailError ? "true" : undefined}
            aria-describedby={emailError ? ids.emailError : undefined}
            className="cs-input h-control-40 w-full rounded px-1.5 font-mohave text-body"
          />
          {emailError ? (
            <p
              id={ids.emailError}
              role="alert"
              className="cs-fade-enter font-mohave text-body-sm cs-error"
            >
              {emailError}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="cs-cta h-control-40 w-full rounded font-cakemono font-light text-cake-button uppercase tracking-widest"
        >
          {phase === "sending" ? copy["signin.sending"] : copy["signin.sendCode"]}
        </button>
      </form>
    );
  }

  const describedBy = codeError ? ids.codeError : notice ? ids.notice : undefined;

  return (
    <form
      key="code"
      onSubmit={handleCodeSubmit}
      noValidate
      className="cs-step-enter flex flex-col gap-3"
      aria-busy={busy || undefined}
      data-challenge-dead={challengeDead ? "true" : undefined}
    >
      <StepMark step={2} total={TOTAL_STEPS} label={copy["step.code"]} copy={copy} />

      <div className="flex flex-col gap-1">
        <h1 className="font-cakemono font-light text-cake-display uppercase tracking-widest cs-text leading-none">
          {copy["code.title"]}
        </h1>
        <p className="font-mohave text-body cs-text-2">
          {fillCopy(copy["code.lead"], { email })}
        </p>
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-micro uppercase tracking-widest cs-text-2">
          {copy["code.label"]}
        </span>
        <CodeInput
          ref={codeInput}
          value={code}
          onChange={(next) => {
            setCode(next);
            if (codeError) setCodeError(null);
          }}
          onComplete={(complete) => void verify(complete)}
          disabled={busy || challengeDead}
          invalid={codeError !== null}
          label={copy["code.label"]}
          digitLabel={(n) => fillCopy(copy["code.digit"], { n })}
          describedBy={describedBy}
          autoFocus
        />
        {codeError ? (
          <p
            id={ids.codeError}
            role="alert"
            className="cs-fade-enter font-mohave text-body-sm cs-error"
          >
            {codeError}
          </p>
        ) : notice ? (
          <p
            id={ids.notice}
            aria-live="polite"
            className="cs-fade-enter font-mohave text-body-sm cs-success"
          >
            {notice}
          </p>
        ) : null}
      </div>

      {challengeDead ? (
        // The challenge is closed for good: the one way forward takes the CTA slot.
        <button
          type="button"
          onClick={returnToEmail}
          disabled={busy}
          className="cs-cta h-control-40 w-full rounded font-cakemono font-light text-cake-button uppercase tracking-widest"
        >
          {copy["code.sendNew"]}
        </button>
      ) : (
        <button
          type="submit"
          disabled={busy || code.length !== CODE_LENGTH}
          className="cs-cta h-control-40 w-full rounded font-cakemono font-light text-cake-button uppercase tracking-widest"
        >
          {phase === "verifying" ? copy["code.verifying"] : copy["code.verify"]}
        </button>
      )}

      <div className="flex items-center justify-between gap-2">
        {challengeDead ? (
          <span aria-hidden="true" />
        ) : (
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={!canResend}
            aria-live="polite"
            className="cs-ghost font-mono text-micro uppercase tracking-widest tabular-nums"
          >
            {secondsLeft > 0
              ? fillCopy(copy["code.resendIn"], { time: formatCountdown(secondsLeft) })
              : copy["code.resend"]}
          </button>
        )}
        <button
          type="button"
          onClick={returnToEmail}
          disabled={busy}
          className="cs-ghost font-mohave text-body-sm"
        >
          {copy["code.changeEmail"]}
        </button>
      </div>
    </form>
  );
}
