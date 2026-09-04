"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { Locale } from "@/i18n/types";
import { useCustomerHosted } from "../customer-context";
import { CodeInput, CODE_LENGTH, type CodeInputHandle } from "../code-input";
import { StepMark } from "../step-mark";
import { DEFAULT_RETRY_AFTER_SECONDS } from "../customer-api";
import {
  fillCopy,
  formatCountdown,
  isPlausibleEmail,
  type CustomerCopy,
} from "@/lib/customer-identity/hosted-format";
import {
  holdBookingSlot,
  readAvailability,
  sendBookingCode,
  verifyBooking,
  type BookingResult,
  type BookingVerifyOutcome,
  type ContactOutcome,
  type HoldOutcome,
} from "./booking-api";
import {
  availabilityRange,
  formatSlotStamp,
  formatZoneLabel,
  groupSlotsByDay,
  isPlausiblePhone,
  safeTimeZone,
  type Availability,
  type AvailableSlot,
  type BookingDay,
} from "./booking-format";
import { DayStrip } from "./day-strip";
import { SlotGrid } from "./slot-grid";
import { HoldPanel } from "./hold-panel";
import { BookingDone } from "./booking-done";

type Step = "time" | "details" | "code";
type Phase = "idle" | "holding" | "sending" | "verifying";
type Load = "loading" | "ready" | "error" | "gone";

const TOTAL_STEPS = 3;

/** Remaining attempts are surfaced only once they are scarce (contract: ≤ 2). */
const ATTEMPTS_WARNING_THRESHOLD = 2;

interface Contact {
  name: string;
  email: string;
  phone: string;
}

/** Which field a details-step error belongs to; `null` for broker failures. */
type DetailsField = "name" | "email" | "phone";
interface DetailsError {
  field: DetailsField | null;
  message: string;
}

const EMPTY_CONTACT: Contact = { name: "", email: "", phone: "" };

function holdFailureCopy(failure: Extract<HoldOutcome, { ok: false }>, copy: CustomerCopy): string {
  switch (failure.kind) {
    case "limited":
      return failure.retryAfterSeconds !== null && failure.retryAfterSeconds > 0
        ? fillCopy(copy["book.error.holdLimit"], {
            time: formatCountdown(failure.retryAfterSeconds),
          })
        : copy["book.error.holdLimitNoTime"];
    case "unknown_handle":
      return copy["notFound.body"];
    case "unavailable":
      return copy["book.error.unavailable"];
    case "offline":
      return copy["error.offline"];
    default:
      return copy["book.error.holdFailed"];
  }
}

function contactFailureCopy(
  failure: Extract<ContactOutcome, { ok: false }>,
  copy: CustomerCopy
): string {
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
      return copy["book.error.unavailable"];
    case "offline":
      return copy["error.offline"];
    default:
      return copy["error.startFailed"];
  }
}

function verifyFailureCopy(
  failure: Extract<BookingVerifyOutcome, { ok: false }>,
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
      return copy["book.error.unavailable"];
    case "offline":
      return copy["error.offline"];
    default:
      return copy["book.error.confirmFailed"];
  }
}

/** A challenge the broker will never accept again: only a fresh code helps. */
function challengeIsDead(failure: Extract<BookingVerifyOutcome, { ok: false }>): boolean {
  if (failure.kind === "exhausted" || failure.kind === "expired") return true;
  return failure.kind === "invalid" && failure.attemptsRemaining === 0;
}

/**
 * Pick a time → your details → confirm by code, then one of two honest
 * endings.
 *
 * Three rules shape the machine:
 *
 * - **A slot is only real when the database says so** (I12). Selecting is
 *   local; the hold happens on CONTINUE, and the confirm can still refuse.
 * - **Holds are scarce** (I13: three at a time). Tapping around the grid
 *   costs nothing; only a deliberate CONTINUE spends a hold.
 * - **An expired hold loses the time, never the typing.** Expiry returns the
 *   visitor to step one with their name, email and phone intact.
 */
export function BookingFlow({ locale }: { locale: Locale }) {
  const { handle, companyName, copy } = useCustomerHosted();

  const [load, setLoad] = useState<Load>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);

  const [step, setStep] = useState<Step>("time");
  const [phase, setPhase] = useState<Phase>("idle");

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  /** Why the visitor is back on step one: a released hold, or a slot someone else took. */
  const [timeNotice, setTimeNotice] = useState<string | null>(null);

  const [contact, setContact] = useState<Contact>(EMPTY_CONTACT);
  const [detailsError, setDetailsError] = useState<DetailsError | null>(null);

  const [intentRef, setIntentRef] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeDead, setChallengeDead] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeNotice, setCodeNotice] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<{ result: BookingResult; ref: string | null } | null>(null);
  /** The stamp is frozen at confirm time so the terminal state survives a refreshed list. */
  const [bookedStamp, setBookedStamp] = useState<string | null>(null);

  // Absolute timestamps, so a backgrounded tab still counts down correctly.
  const [holdExpiresAt, setHoldExpiresAt] = useState<number | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const codeInput = useRef<CodeInputHandle>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const phoneInput = useRef<HTMLInputElement>(null);
  const ids = {
    name: useId(),
    email: useId(),
    phone: useId(),
    timeError: useId(),
    timeNotice: useId(),
    detailsError: useId(),
    codeError: useId(),
    codeNotice: useId(),
  };

  const busy = phase !== "idle";
  const timezone = safeTimeZone(availability?.timezone);
  const days = useMemo(
    () => (availability ? groupSlotsByDay(availability.slots, timezone) : []),
    [availability, timezone]
  );
  const day = days.find((d) => d.key === selectedDay) ?? days[0] ?? null;

  const holdSecondsLeft =
    holdExpiresAt === null ? 0 : Math.max(0, Math.ceil((holdExpiresAt - now) / 1000));
  const resendSecondsLeft =
    resendAt === null ? 0 : Math.max(0, Math.ceil((resendAt - now) / 1000));
  const canResend = step === "code" && !busy && !challengeDead && resendSecondsLeft === 0;

  // ── Availability ───────────────────────────────────────────────────────

  const loadAvailability = useCallback(
    async (mode: "initial" | "background" = "initial") => {
      if (mode === "initial") {
        setLoad("loading");
        setLoadError(null);
      }
      const { from, to } = availabilityRange();
      const outcome = await readAvailability(handle, from, to);

      if (!outcome.ok) {
        // A background refresh that fails leaves the last known list on screen:
        // stale times the confirm still re-checks beat an empty page.
        if (mode === "background") return;
        if (outcome.kind === "unknown_handle") {
          // The route answers 404 for a business that has not turned booking
          // on and for one that does not exist, so this page cannot tell them
          // apart — and must not, or the URL would confirm which is which.
          setLoad("gone");
          return;
        }
        setLoad("error");
        setLoadError(
          outcome.kind === "offline"
            ? copy["error.offline"]
            : outcome.kind === "unavailable"
              ? copy["book.error.unavailable"]
              : copy["book.error.loadFailed"]
        );
        return;
      }

      setAvailability(outcome.availability);
      setLoad("ready");
      setSelectedSlot((current) => {
        if (!current) return null;
        // Keep the pick only if the refreshed list still offers it.
        return outcome.availability.slots.some((s) => s.slot === current.slot) ? current : null;
      });
    },
    [handle, copy]
  );

  useEffect(() => {
    void loadAvailability("initial");
  }, [loadAvailability]);

  // Opening on the soonest day means the first thing on screen is real times,
  // not a prompt to choose a day. The time itself is never pre-picked — that
  // is the decision, and it stays the visitor's.
  useEffect(() => {
    if (selectedDay === null && days.length > 0) setSelectedDay(days[0].key);
  }, [days, selectedDay]);

  // ── Clocks ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (holdExpiresAt === null && resendAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [holdExpiresAt, resendAt]);

  const armResend = useCallback((seconds: number) => {
    const s = seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS;
    setResendAt(Date.now() + s * 1000);
    setNow(Date.now());
  }, []);

  /**
   * Back to step one, holding on to everything the visitor typed. Used when
   * the hold runs out and when the confirm loses the slot — two different
   * sentences, one behaviour.
   */
  const releaseToTimeStep = useCallback(
    (notice: string | null) => {
      setStep("time");
      setPhase("idle");
      setIntentRef(null);
      setHoldExpiresAt(null);
      setResendAt(null);
      setChallengeId(null);
      setChallengeDead(false);
      setCode("");
      setCodeError(null);
      setCodeNotice(null);
      setDetailsError(null);
      setSelectedSlot(null);
      setTimeError(null);
      setTimeNotice(notice);
      void loadAvailability("background");
    },
    [loadAvailability]
  );

  useEffect(() => {
    if (holdExpiresAt === null || holdSecondsLeft > 0) return;
    releaseToTimeStep(copy["book.hold.expired"]);
  }, [holdExpiresAt, holdSecondsLeft, releaseToTimeStep, copy]);

  // ── Step 1: pick a time ────────────────────────────────────────────────

  function handleSelectDay(next: BookingDay) {
    setSelectedDay(next.key);
    setSelectedSlot(null);
    setTimeError(null);
  }

  function handleSelectSlot(slot: AvailableSlot) {
    setSelectedSlot(slot);
    setTimeError(null);
    setTimeNotice(null);
  }

  async function handleContinue() {
    if (busy || !selectedSlot) return;
    setPhase("holding");
    setTimeError(null);
    setTimeNotice(null);
    const held = await holdBookingSlot(handle, selectedSlot.slot);
    setPhase("idle");

    if (!held.ok) {
      if (held.kind === "slot_taken") {
        releaseToTimeStep(copy["book.hold.taken"]);
        return;
      }
      setTimeError(holdFailureCopy(held, copy));
      return;
    }

    setIntentRef(held.intentRef);
    setHoldExpiresAt(held.holdExpiresAt);
    setNow(Date.now());
    setStep("details");
  }

  // ── Step 2: your details ───────────────────────────────────────────────

  const requestCode = useCallback(
    async (ref: string, details: Contact, target: Step): Promise<boolean> => {
      setPhase("sending");
      const sent = await sendBookingCode(handle, ref, {
        name: details.name,
        email: details.email,
        phone: details.phone.trim() || null,
      });
      setPhase("idle");

      if (!sent.ok) {
        if (sent.kind === "hold_expired") {
          releaseToTimeStep(copy["book.hold.expired"]);
          return false;
        }
        if (sent.kind === "rate_limited" && sent.retryAfterSeconds) {
          armResend(sent.retryAfterSeconds);
        }
        const message = contactFailureCopy(sent, copy);
        if (target === "code") setCodeError(message);
        else setDetailsError({ field: null, message });
        return false;
      }

      setChallengeId(sent.challengeId);
      setChallengeDead(false);
      armResend(sent.retryAfterSeconds);
      return true;
    },
    [handle, copy, armResend, releaseToTimeStep]
  );

  async function handleDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !intentRef) return;

    const details: Contact = {
      name: contact.name.trim(),
      email: contact.email.trim(),
      phone: contact.phone.trim(),
    };

    if (details.name.length === 0) {
      setDetailsError({ field: "name", message: copy["book.error.nameRequired"] });
      nameInput.current?.focus();
      return;
    }
    if (!isPlausibleEmail(details.email)) {
      setDetailsError({ field: "email", message: copy["error.emailInvalid"] });
      emailInput.current?.focus();
      return;
    }
    if (!isPlausiblePhone(details.phone)) {
      setDetailsError({ field: "phone", message: copy["book.error.phoneInvalid"] });
      phoneInput.current?.focus();
      return;
    }

    setDetailsError(null);
    setContact(details);
    const sent = await requestCode(intentRef, details, "details");
    if (sent) {
      setCode("");
      setCodeError(null);
      setCodeNotice(null);
      setStep("code");
    }
  }

  // ── Step 3: confirm by code ────────────────────────────────────────────

  const verify = useCallback(
    async (candidate: string) => {
      if (!intentRef || !challengeId || challengeDead || candidate.length !== CODE_LENGTH) return;
      setPhase("verifying");
      setCodeError(null);
      setCodeNotice(null);
      const result = await verifyBooking(
        handle,
        intentRef,
        challengeId,
        candidate,
        contact.email
      );

      if (result.ok) {
        // The server's booked time wins over the slot the page held.
        const booked = result.scheduledAt ?? selectedSlot?.startAt ?? null;
        setBookedStamp(booked ? formatSlotStamp(booked, timezone, locale) : null);
        setHoldExpiresAt(null);
        setResendAt(null);
        setPhase("idle");
        setOutcome({ result: result.result, ref: result.bookingRef });
        return;
      }

      setPhase("idle");
      if (result.kind === "slot_taken") {
        releaseToTimeStep(copy["book.hold.taken"]);
        return;
      }
      if (result.kind === "hold_expired") {
        releaseToTimeStep(copy["book.hold.expired"]);
        return;
      }

      setCode("");
      setCodeError(verifyFailureCopy(result, copy));
      if (challengeIsDead(result)) {
        setChallengeDead(true);
        return;
      }
      codeInput.current?.focusFirst();
    },
    [
      intentRef,
      challengeId,
      challengeDead,
      handle,
      contact.email,
      selectedSlot,
      timezone,
      locale,
      copy,
      releaseToTimeStep,
    ]
  );

  function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    void verify(code);
  }

  async function handleResend() {
    if (!canResend || !intentRef) return;
    setCodeError(null);
    setCodeNotice(null);
    setCode("");
    const sent = await requestCode(intentRef, contact, "code");
    if (sent) {
      setCodeNotice(copy["code.resent"]);
      codeInput.current?.focusFirst();
    }
  }

  /** Back to the details step with the hold — and the typing — intact. */
  function returnToDetails() {
    if (busy) return;
    setStep("details");
    setChallengeId(null);
    setChallengeDead(false);
    setCode("");
    setCodeError(null);
    setCodeNotice(null);
    setDetailsError(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (outcome) {
    return (
      <BookingDone
        result={outcome.result}
        stamp={bookedStamp ?? "—"}
        email={contact.email}
        companyName={companyName}
        bookingRef={outcome.ref}
        handle={handle}
        copy={copy}
      />
    );
  }

  if (load === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <div className="flex flex-col gap-0.5">
          <span className="cs-skeleton h-1.5 w-1/4 rounded-chip animate-pulse" />
          <span className="cs-skeleton h-2 w-1/2 rounded-chip animate-pulse" />
        </div>
        <div className="grid grid-cols-4 gap-0.5">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className="cs-skeleton h-control-40 rounded animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-0.5">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="cs-skeleton h-control-40 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (load === "gone") {
    return (
      <div className="cs-fade-enter flex flex-col gap-1" data-booking-step="gone">
        <h1 className="font-cakemono font-light text-cake-display uppercase tracking-widest cs-text leading-none">
          {copy["notFound.title"]}
        </h1>
        <p className="font-mohave text-body cs-text-2">{copy["notFound.body"]}</p>
      </div>
    );
  }

  if (load === "error") {
    return (
      <div className="cs-fade-enter flex flex-col gap-2">
        <p role="alert" className="font-mohave text-body cs-error">
          {loadError ?? copy["book.error.loadFailed"]}
        </p>
        <button
          type="button"
          onClick={() => void loadAvailability("initial")}
          className="cs-secondary h-control-36 self-start rounded px-2 font-cakemono font-light text-cake-button uppercase tracking-widest"
        >
          {copy["book.retry"]}
        </button>
      </div>
    );
  }

  if (step === "time") {
    // Nothing open, and nothing to apologise for: the days that would have
    // said "unavailable" are simply not here (design §7).
    if (days.length === 0) {
      return (
        <div className="cs-step-enter flex flex-col gap-1" data-booking-step="empty">
          <h1 className="font-cakemono font-light text-cake-display uppercase tracking-widest cs-text leading-none">
            {copy["book.empty.title"]}
          </h1>
          <p className="font-mohave text-body cs-text-2">
            {fillCopy(copy["book.empty.body"], { company: companyName })}
          </p>
        </div>
      );
    }

    const zone = day ? formatZoneLabel(day.date, timezone, locale) : "";

    return (
      <div className="cs-step-enter flex flex-col gap-3" data-booking-step="time">
        <StepMark step={1} total={TOTAL_STEPS} label={copy["book.step.time"]} copy={copy} />

        <div className="flex flex-col gap-1">
          <h1 className="font-cakemono font-light text-cake-display uppercase tracking-widest cs-text leading-none">
            {copy["book.time.title"]}
          </h1>
          <p className="font-mohave text-body cs-text-2">
            {availability?.mode === "request"
              ? fillCopy(copy["book.time.leadRequest"], { company: companyName })
              : copy["book.time.lead"]}
          </p>
          {timeNotice ? (
            <p
              id={ids.timeNotice}
              role="status"
              className="cs-fade-enter font-mohave text-body-sm cs-warning"
            >
              {timeNotice}
            </p>
          ) : null}
        </div>

        <DayStrip
          days={days}
          selectedKey={day?.key ?? null}
          onSelect={handleSelectDay}
          timezone={timezone}
          locale={locale}
          disabled={busy}
          label={copy["book.time.dayLabel"]}
          moreLabel={copy["book.time.moreDays"]}
        />

        {day ? (
          <SlotGrid
            slots={day.slots}
            selected={selectedSlot?.slot ?? null}
            onSelect={handleSelectSlot}
            timezone={timezone}
            locale={locale}
            disabled={busy}
            label={copy["book.time.slotLabel"]}
            dayKey={day.key}
          />
        ) : null}

        {availability && availability.durationMinutes > 0 ? (
          <span className="font-mono text-micro uppercase tracking-widest cs-text-2 tabular-nums">
            {fillCopy(copy["book.time.meta"], {
              minutes: availability.durationMinutes,
              zone,
            })}
          </span>
        ) : null}

        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => void handleContinue()}
            disabled={busy || !selectedSlot}
            aria-describedby={timeError ? ids.timeError : undefined}
            className="cs-cta h-control-40 w-full rounded font-cakemono font-light text-cake-button uppercase tracking-widest"
          >
            {phase === "holding" ? copy["book.time.holding"] : copy["book.time.continue"]}
          </button>
          {timeError ? (
            <p
              id={ids.timeError}
              role="alert"
              className="cs-fade-enter font-mohave text-body-sm cs-error"
            >
              {timeError}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const stamp = selectedSlot ? formatSlotStamp(selectedSlot.startAt, timezone, locale) : "—";

  if (step === "details") {
    return (
      <form
        key="details"
        onSubmit={handleDetailsSubmit}
        noValidate
        className="cs-step-enter flex flex-col gap-3"
        aria-busy={busy || undefined}
        data-booking-step="details"
      >
        <StepMark step={2} total={TOTAL_STEPS} label={copy["book.step.details"]} copy={copy} />

        <div className="flex flex-col gap-1">
          <h1 className="font-cakemono font-light text-cake-display uppercase tracking-widest cs-text leading-none">
            {copy["book.details.title"]}
          </h1>
          <p className="font-mohave text-body cs-text-2">
            {fillCopy(copy["book.details.lead"], { company: companyName })}
          </p>
        </div>

        <HoldPanel
          stamp={stamp}
          secondsLeft={holdSecondsLeft}
          copy={copy}
          disabled={busy}
          onChangeTime={() => releaseToTimeStep(null)}
        />

        <div className="flex flex-col gap-0.5">
          <label
            htmlFor={ids.name}
            className="font-mono text-micro uppercase tracking-widest cs-text-2"
          >
            {copy["book.details.nameLabel"]}
          </label>
          <input
            ref={nameInput}
            id={ids.name}
            name="name"
            type="text"
            autoComplete="name"
            required
            autoFocus
            disabled={busy}
            value={contact.name}
            onChange={(event) => {
              setContact((c) => ({ ...c, name: event.target.value }));
              if (detailsError) setDetailsError(null);
            }}
            placeholder={copy["book.details.namePlaceholder"]}
            aria-invalid={detailsError?.field === "name" ? "true" : undefined}
            aria-describedby={detailsError ? ids.detailsError : undefined}
            className="cs-input h-control-40 w-full rounded px-1.5 font-mohave text-body"
          />
        </div>

        <div className="flex flex-col gap-0.5">
          <label
            htmlFor={ids.email}
            className="font-mono text-micro uppercase tracking-widest cs-text-2"
          >
            {copy["book.details.emailLabel"]}
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
            disabled={busy}
            value={contact.email}
            onChange={(event) => {
              setContact((c) => ({ ...c, email: event.target.value }));
              if (detailsError) setDetailsError(null);
            }}
            placeholder={copy["book.details.emailPlaceholder"]}
            aria-invalid={detailsError?.field === "email" ? "true" : undefined}
            aria-describedby={detailsError ? ids.detailsError : undefined}
            className="cs-input h-control-40 w-full rounded px-1.5 font-mohave text-body"
          />
        </div>

        <div className="flex flex-col gap-0.5">
          <label
            htmlFor={ids.phone}
            className="font-mono text-micro uppercase tracking-widest cs-text-2"
          >
            {copy["book.details.phoneLabel"]}
          </label>
          <input
            ref={phoneInput}
            id={ids.phone}
            name="tel"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            disabled={busy}
            value={contact.phone}
            onChange={(event) => {
              setContact((c) => ({ ...c, phone: event.target.value }));
              if (detailsError) setDetailsError(null);
            }}
            placeholder={copy["book.details.phonePlaceholder"]}
            aria-invalid={detailsError?.field === "phone" ? "true" : undefined}
            aria-describedby={detailsError ? ids.detailsError : undefined}
            className="cs-input h-control-40 w-full rounded px-1.5 font-mohave text-body"
          />
        </div>

        {detailsError ? (
          <p
            id={ids.detailsError}
            role="alert"
            className="cs-fade-enter font-mohave text-body-sm cs-error"
          >
            {detailsError.message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="cs-cta h-control-40 w-full rounded font-cakemono font-light text-cake-button uppercase tracking-widest"
        >
          {phase === "sending" ? copy["book.details.sending"] : copy["book.details.send"]}
        </button>
      </form>
    );
  }

  const describedBy = codeError ? ids.codeError : codeNotice ? ids.codeNotice : undefined;

  return (
    <form
      key="code"
      onSubmit={handleCodeSubmit}
      noValidate
      className="cs-step-enter flex flex-col gap-3"
      aria-busy={busy || undefined}
      data-booking-step="code"
      data-challenge-dead={challengeDead ? "true" : undefined}
    >
      <StepMark step={3} total={TOTAL_STEPS} label={copy["step.code"]} copy={copy} />

      <div className="flex flex-col gap-1">
        <h1 className="font-cakemono font-light text-cake-display uppercase tracking-widest cs-text leading-none">
          {copy["book.code.title"]}
        </h1>
        <p className="font-mohave text-body cs-text-2">
          {fillCopy(copy["book.code.lead"], { email: contact.email })}
        </p>
      </div>

      <HoldPanel stamp={stamp} secondsLeft={holdSecondsLeft} copy={copy} />

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
        ) : codeNotice ? (
          <p
            id={ids.codeNotice}
            aria-live="polite"
            className="cs-fade-enter font-mohave text-body-sm cs-success"
          >
            {codeNotice}
          </p>
        ) : null}
      </div>

      {challengeDead ? (
        // The challenge is closed for good: the one way forward takes the CTA slot.
        <button
          type="button"
          onClick={returnToDetails}
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
          {phase === "verifying" ? copy["book.code.verifying"] : copy["book.code.verify"]}
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
            {resendSecondsLeft > 0
              ? fillCopy(copy["code.resendIn"], { time: formatCountdown(resendSecondsLeft) })
              : copy["code.resend"]}
          </button>
        )}
        <button
          type="button"
          onClick={returnToDetails}
          disabled={busy}
          className="cs-ghost font-mohave text-body-sm"
        >
          {copy["book.code.changeDetails"]}
        </button>
      </div>
    </form>
  );
}
