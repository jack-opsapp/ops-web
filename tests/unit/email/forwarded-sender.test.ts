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
  extractContactFormSubmission,
  extractContactFormSubmissionDiagnostics,
  extractForwardedSender,
  resolveEffectiveSenderEmail,
  stripQuotedContent,
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
  const WIX_CONTACT_FORM_FORWARD = `Thanks,
Jared Jerome
778-268-3324
Canpro Deck and Rail

Sent from my iPhone

Begin forwarded message:

From: Canpro Deck and Rail <notifications@wix-forms.com>
Date: May 20, 2026 at 14:46:39 MDT
To: jared@example-contractors.com
Subject: Contact Us 3 got a new submission
Reply-To: "marcel.mercier@example.com" <marcel.mercier@example.com>

A site visitor just submitted your form Contact Us 3 on example-contractors

Submission summary:

Full Name:
Marcel Mercier

Phone:
12505388340

Email:
marcel.mercier@example.com

Address:
1182 Hewlett Place, Oak Bay

How can we help?:
We need someone to renovate and replace two existing roof decks.

View Submissions

This email was sent as a notification from this site.`;

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

  it("prefers a contact-form submitter over the internal forwarder and platform sender", () => {
    const r = resolveEffectiveSenderEmail({
      fromHeader: "Jared Jerome <jared@example-contractors.com>",
      subject: "Fwd: Contact Us 3 got a new submission",
      bodyText: WIX_CONTACT_FORM_FORWARD,
      connectionEmail: "office@example-contractors.com",
    }) as ReturnType<typeof resolveEffectiveSenderEmail> & {
      name?: string;
      phone?: string | null;
    };

    expect(r.email).toBe("marcel.mercier@example.com");
    expect(r.name).toBe("Marcel Mercier");
    expect(r.phone).toBe("12505388340");
    expect(r.source).toBe("contact_form");
  });

  it("strips the forwarded wrapper but keeps the submitted contact-form fields for display", () => {
    const display = stripQuotedContent(WIX_CONTACT_FORM_FORWARD);

    expect(display).toContain("Full Name:");
    expect(display).toContain("Marcel Mercier");
    expect(display).toContain("How can we help?:");
    expect(display).toContain(
      "We need someone to renovate and replace two existing roof decks."
    );
    expect(display).not.toContain("Sent from my iPhone");
    expect(display).not.toContain("Begin forwarded message:");
    expect(display).not.toContain("View Submissions");
  });

  it("prefers the submitted email field over a Wix relay Reply-To address", () => {
    const body = `Begin forwarded message:

From: Catherine Audet <reply-to+fc582f9694e9@wixforms.com>
Date: February 24, 2026 at 14:26:05 MST
To: jared@example-contractors.com
Subject: [canpro-deck-and-rail] Free Quote form - new submission
Reply-To: Catherine Audet <d9e3d0ba-32c6-4fed-bd8a-cc589ab2c391@ascend.wix.com>

Catherine Audet just submitted your form: Free Quote form

Message Details:

Name: Catherine Audet

Phone Number: 2502662446

Email Address: cath.audet@example.com

Location: Salt Spring Island

How Can We Help?: Deck quote request`;

    const submission = extractContactFormSubmission(
      "Fwd: [canpro-deck-and-rail] Free Quote form - new submission",
      body
    );

    expect(submission?.email).toBe("cath.audet@example.com");
    expect(submission?.name).toBe("Catherine Audet");
    expect(submission?.phone).toBe("2502662446");
  });

  it("uses partial contact-form fields without inventing missing phone values", () => {
    const body = `New contact form submission

Name: Priya Shah
Email: priya@example.net
Message: Need a quote for deck resurfacing.`;

    const r = resolveEffectiveSenderEmail({
      fromHeader: "Website <notifications@forms.example>",
      subject: "New contact form",
      bodyText: body,
      connectionEmail: "office@example-contractors.com",
    }) as ReturnType<typeof resolveEffectiveSenderEmail> & {
      name?: string;
      phone?: string | null;
    };

    expect(r.email).toBe("priya@example.net");
    expect(r.name).toBe("Priya Shah");
    expect(r.phone).toBeNull();
    expect(r.source).toBe("contact_form");
  });

  it("matches longer contact-form labels before shorter prefix labels", () => {
    const body = `New contact form submission

Name: John Smith
Email Address: john@example.com
Phone Number: 604-555-0101
Message: Need a quote`;

    const r = resolveEffectiveSenderEmail({
      fromHeader: "Website <notifications@forms.example>",
      subject: "New contact form",
      bodyText: body,
      connectionEmail: "office@example-contractors.com",
    }) as ReturnType<typeof resolveEffectiveSenderEmail> & {
      name?: string;
      phone?: string | null;
      message?: string | null;
    };

    expect(r.email).toBe("john@example.com");
    expect(r.name).toBe("John Smith");
    expect(r.phone).toBe("604-555-0101");
    expect(r.message).toBe("Need a quote");
    expect(r.source).toBe("contact_form");
  });

  it("sanitizes live multiline contact-form phone fields before downstream labels", () => {
    const cases = [
      {
        phone: "7786773812",
        city: "sooke bc",
        railing: "glass rail",
      },
      {
        phone: "7785840514",
        city: "Victoria",
        railing: "Full deck replacement",
      },
    ];

    for (const item of cases) {
      const body = `New contact form submission

Full Name:
Sarah Client

Email:
sarah@example.com

Phone:
${item.phone}
City Location:
${item.city}
Railing / Vinyl or Full D:
${item.railing}`;

      const submission = extractContactFormSubmission("New contact form", body);
      const diagnostics = extractContactFormSubmissionDiagnostics(
        "New contact form",
        body
      );

      expect(submission?.email).toBe("sarah@example.com");
      expect(submission?.phone).toBe(item.phone);
      expect(diagnostics?.warnings).toContain(
        "Phone field sanitized before proposed write"
      );
    }
  });

  it("stops multiline first-name collection at inline downstream labels", () => {
    const body = `New contact form submission

First Name:
John
Last Name: Smith
Email: john@example.com
Phone: 604-555-0101
Message: Need a quote`;

    const r = resolveEffectiveSenderEmail({
      fromHeader: "Website <notifications@forms.example>",
      subject: "New contact form",
      bodyText: body,
      connectionEmail: "office@example-contractors.com",
    }) as ReturnType<typeof resolveEffectiveSenderEmail> & {
      name?: string;
      phone?: string | null;
      message?: string | null;
    };

    expect(r.email).toBe("john@example.com");
    expect(r.name).toBe("John Smith");
    expect(r.phone).toBe("604-555-0101");
    expect(r.message).toBe("Need a quote");
    expect(r.source).toBe("contact_form");
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
