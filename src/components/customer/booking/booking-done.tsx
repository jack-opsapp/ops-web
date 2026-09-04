"use client";

import Link from "next/link";
import { fillCopy, type CustomerCopy } from "@/lib/customer-identity/hosted-format";
import type { BookingResult } from "./booking-api";

interface BookingDoneProps {
  result: BookingResult;
  /** `Mon, Sep 8 · 9:00 AM` — the fact the whole screen exists to deliver. */
  stamp: string;
  email: string;
  companyName: string;
  bookingRef: string | null;
  handle: string;
  copy: CustomerCopy;
}

/**
 * The end of the flow, in one of two honest shapes.
 *
 * `confirmed` states the appointment and what happens next. `submitted` says
 * plainly that the business still has to confirm and that the time is not
 * held until they do (design §7, I14) — carried by the words and by an
 * attention tag, never by colour alone.
 *
 * An account is offered exactly once here, as a quiet line under a hairline.
 * Nobody has to make one: the booking is already real (D11).
 */
export function BookingDone({
  result,
  stamp,
  email,
  companyName,
  bookingRef,
  handle,
  copy,
}: BookingDoneProps) {
  const booked = result === "confirmed";

  return (
    <div className="cs-step-enter flex flex-col gap-3" data-booking-outcome={result}>
      <div className="flex flex-col gap-1">
        <h1 className="font-cakemono font-light text-cake-display uppercase tracking-widest cs-text leading-none">
          {booked ? copy["book.done.booked.title"] : copy["book.done.requested.title"]}
        </h1>

        <div className="flex flex-wrap items-center gap-1">
          <span className="font-mono text-data-lg uppercase tabular-nums cs-text">{stamp}</span>
          {booked ? null : (
            <span className="cs-tag-attention rounded-chip px-0.5 font-mono text-micro uppercase tracking-wide">
              {copy["book.done.requested.tag"]}
            </span>
          )}
        </div>

        <p className="font-mohave text-body cs-text-2">
          {fillCopy(booked ? copy["book.done.booked.body"] : copy["book.done.requested.body"], {
            company: companyName,
          })}
        </p>
      </div>

      <p className="font-mohave text-body-sm cs-text-2">
        {fillCopy(booked ? copy["book.done.booked.next"] : copy["book.done.requested.next"], {
          email,
        })}
      </p>

      {bookingRef ? (
        // The reference is an opaque token — it is never case-folded, because a
        // visitor may read it back to the business exactly as issued.
        <span className="font-mono text-micro tracking-widest cs-text-2">
          {fillCopy(copy["book.done.ref"], { ref: bookingRef })}
        </span>
      ) : null}

      <div className="border-t cs-line pt-1.5 flex flex-wrap items-center justify-between gap-1">
        <span className="font-mohave text-body-sm cs-text-2">{copy["book.done.account"]}</span>
        <Link
          href={`/c/${handle}/signin`}
          className="cs-ghost font-cakemono font-light text-cake-button uppercase tracking-widest"
        >
          {copy["book.done.accountAction"]}
        </Link>
      </div>
    </div>
  );
}
