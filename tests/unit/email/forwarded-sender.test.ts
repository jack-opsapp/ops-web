/**
 * Unit tests for forwarded-sender extraction. The shipping use case is the
 * "self-forwarded lead" pattern — operator forwards a customer email from
 * one of their own mailboxes (victoria@…) into the connected mailbox
 * (canprojack@…). Without these helpers, `latest_sender_email` on the
 * resulting email_threads row points at the operator instead of the
 * customer, silently filtering the thread out of the Phase C draft pipeline.
 *
 * Each forwarder client lays out the inlined upstream message slightly
 * differently — Gmail wraps it in "---------- Forwarded message ---------",
 * Apple Mail uses "Begin forwarded message:", Outlook/M365 uses a
 * contiguous header block "From: …\nSent: …\nTo: …" with no preamble.
 * The extractor must succeed on all three.
 */
import { describe, it, expect } from "vitest";
import {
  extractForwardedSender,
  resolveEffectiveSenderEmail,
} from "@/lib/utils/email-parsing";

const GMAIL_FORWARDED = `Hi team — forwarding this lead. Take a look.

Jackson

---------- Forwarded message ---------
From: Judith Love <judy55love@gmail.com>
Date: Thu, Apr 23, 2026 at 7:14 AM
Subject: Canpro Deck and Rail Estimate
To: <victoria@canprodeckandrail.com>

Hi there,
I'm at The Haro condos in Cordova Bay and I have several posts that are bubbling. I'd like a quote for sanding and repainting them.
Judy
`;

const APPLE_MAIL_FORWARDED = `FYI on this one.

> Begin forwarded message:
>
> From: David Riddell <riddellholdings@gmail.com>
> Subject: Canpro Deck and Rail Estimate
> Date: April 23, 2026 at 9:49:00 AM PDT
> To: victoria@canprodeckandrail.com
>
> Jackson, Thank you for your reply...
`;

const OUTLOOK_FORWARDED = `From: Marie Tremblay <marie@example.com>
Sent: Thursday, April 23, 2026 9:14 AM
To: Victoria Sales <victoria@canprodeckandrail.com>
Subject: Canpro Deck and Rail Estimate

Hi Victoria, I'd like a quote for railing replacement on a 14m balcony.
Marie
`;

const NOT_FORWARDED = `Hi Jackson,

Thanks for getting back to me. Looking forward to the quote.

Cheers,
David Riddell
604-657-1864
riddellholdings@gmail.com
`;

const FWD_SUBJECT_NO_BODY_MARKER = `Subject was Fwd: but body just has a header block:
From: Casey Long <casey@example.org>
Sent: 2026-05-01 09:00
To: ops@example.org

Looking for a quote on the front porch railing.
`;

describe("extractForwardedSender", () => {
  it("parses Gmail-style forwarded preamble", () => {
    expect(
      extractForwardedSender("Fwd: Canpro Deck and Rail Estimate", GMAIL_FORWARDED)
    ).toBe("judy55love@gmail.com");
  });

  it("parses Apple Mail 'Begin forwarded message:' preamble", () => {
    expect(
      extractForwardedSender("Fwd: Canpro Deck and Rail Estimate", APPLE_MAIL_FORWARDED)
    ).toBe("riddellholdings@gmail.com");
  });

  it("parses Outlook-style header block with no preamble", () => {
    expect(
      extractForwardedSender("Fwd: Canpro Deck and Rail Estimate", OUTLOOK_FORWARDED)
    ).toBe("marie@example.com");
  });

  it("returns null on a non-forwarded body", () => {
    expect(
      extractForwardedSender("Re: Canpro Deck and Rail Estimate", NOT_FORWARDED)
    ).toBeNull();
  });

  it("uses the Fwd: subject as a marker when body has only a header block at top", () => {
    expect(
      extractForwardedSender("Fwd: Quote request", FWD_SUBJECT_NO_BODY_MARKER)
    ).toBe("casey@example.org");
  });

  it("returns null on an empty body even with a Fwd: subject", () => {
    expect(extractForwardedSender("Fwd: anything", "")).toBeNull();
  });

  it("normalizes CRLF line endings before scanning", () => {
    const crlf = GMAIL_FORWARDED.replace(/\n/g, "\r\n");
    expect(extractForwardedSender("Fwd: Test", crlf)).toBe("judy55love@gmail.com");
  });

  it("ignores prose 'from:' phrases above the forwarded block", () => {
    const body = `Got a note from: the field crew on this one — see below.\n\n${GMAIL_FORWARDED}`;
    expect(extractForwardedSender("Fwd: Test", body)).toBe("judy55love@gmail.com");
  });

  it("strips angle brackets from RFC822 'Display Name <email>' header values", () => {
    expect(extractForwardedSender("Fwd: Test", GMAIL_FORWARDED)).toBe(
      "judy55love@gmail.com"
    );
  });

  it("falls through to bare email when the From line has no angle brackets", () => {
    const body = `---------- Forwarded message ---------\nFrom: bare@example.com\nSubject: Quote\n\nHi.\n`;
    expect(extractForwardedSender("Fwd: Test", body)).toBe("bare@example.com");
  });

  it("lowercases the extracted email for stable comparison", () => {
    const body = `---------- Forwarded message ---------\nFrom: Judith Love <Judy55LOVE@Gmail.COM>\n\nHi.\n`;
    expect(extractForwardedSender("Fwd: Test", body)).toBe("judy55love@gmail.com");
  });
});

describe("resolveEffectiveSenderEmail", () => {
  it("prefers forwarded upstream sender over the From header", () => {
    const r = resolveEffectiveSenderEmail({
      fromHeader: "Jackson Sweet <canprojack@gmail.com>",
      subject: "Fwd: Canpro Deck and Rail Estimate",
      bodyText: GMAIL_FORWARDED,
      connectionEmail: "canprojack@gmail.com",
    });
    expect(r.email).toBe("judy55love@gmail.com");
    expect(r.source).toBe("forwarded");
  });

  it("falls back to From header when no forward marker is present", () => {
    const r = resolveEffectiveSenderEmail({
      fromHeader: "David Riddell <riddellholdings@gmail.com>",
      subject: "Re: Canpro Deck and Rail Estimate",
      bodyText: NOT_FORWARDED,
      connectionEmail: "canprojack@gmail.com",
    });
    expect(r.email).toBe("riddellholdings@gmail.com");
    expect(r.source).toBe("from_header");
  });

  it("falls back to From header when the upstream sender IS the operator", () => {
    // Edge case: operator forwards a draft they wrote to themselves. The
    // upstream From: line resolves back to the operator's own address, so
    // we should NOT treat it as a recovered sender.
    const body = `---------- Forwarded message ---------\nFrom: Jackson <canprojack@gmail.com>\nSubject: draft\n\nDraft.\n`;
    const r = resolveEffectiveSenderEmail({
      fromHeader: "Jackson Sweet <canprojack@gmail.com>",
      subject: "Fwd: draft",
      bodyText: body,
      connectionEmail: "canprojack@gmail.com",
    });
    expect(r.email).toBe("canprojack@gmail.com");
    expect(r.source).toBe("from_header");
  });

  it("works when connectionEmail is null (no operator address known)", () => {
    const r = resolveEffectiveSenderEmail({
      fromHeader: "Jackson Sweet <canprojack@gmail.com>",
      subject: "Fwd: Canpro Deck and Rail Estimate",
      bodyText: GMAIL_FORWARDED,
      connectionEmail: null,
    });
    expect(r.email).toBe("judy55love@gmail.com");
    expect(r.source).toBe("forwarded");
  });
});
