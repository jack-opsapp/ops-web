import { describe, it, expect } from "vitest";
import {
  cleanMessageBody,
  normalizeBodyLines,
  sanitizeSummaryEvidenceBody,
  stripSignatureBlock,
} from "@/lib/api/services/conversation-state/message-cleaner";
import { stripOutlookReplyHeaderBlock } from "@/lib/utils/email-parsing";

/**
 * Bug 7ca126d2 — the Vitrum body shape.
 *
 * Modelled byte-for-byte on the plain-text Outlook produced for the supplier
 * replies that poisoned lead b444e6fc (names anonymized, structure identical):
 * space-only "blank" lines, a pipe-delimited contact card with no sign-off word
 * above it, and a quoted reply header whose mangled Unicode arrived as literal
 * "â€چ" sequences. Every existing stripper walked straight past all three.
 */
const OUTLOOK_MANGLED = [
  "Morning Jackson, ",
  "",
  " ",
  " ",
  " ",
  "Thank you for the Order, a con",
  " ",
  " ",
  "JANE DOE | INSIDE SALES REP | ",
  "jdoe@supplier.com",
  " ",
  "T: ",
  "604-555-3513 ext. 8723 | ",
  "9785 201 St Sample Twp, BC V1M 3E7 | ",
  "www.supplier.ca",
  " ",
  " ",
  " ",
  " ",
  "From: Jackson Sweet <ops@example.com>",
  "Sent: Thursday, August 27, 2026 10:12 AM",
  "To: Jane Doe <jdoe@supplier.com>",
  "Subject: Re: [EXTERNAL] PO Nelson Replacement",
  " ",
  "â€چ â€چ â€چ â€چ â€چ Hi Jane, For this job please use PO 3934 Jean Pl.",
].join("\n");

/** Zero-width, bidi-control, and BOM code points — none may survive cleaning. */
const INVISIBLE_CHARS_RE =
  /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

function expectVitrumArtifactsGone(cleaned: string): void {
  expect(cleaned).toContain("Thank you for the Order");
  expect(cleaned).not.toContain("From:");
  expect(cleaned).not.toContain("Sent:");
  expect(cleaned).not.toContain("INSIDE SALES REP");
  expect(cleaned).not.toContain("9785 201 St");
  expect(cleaned).not.toContain("604-555-3513");
  expect(cleaned).not.toContain("www.supplier.ca");
  expect(cleaned).not.toContain("â€");
  expect(INVISIBLE_CHARS_RE.test(cleaned)).toBe(false);
}

describe("stripSignatureBlock", () => {
  it("strips a `-- ` delimited signature block, keeping only the message", () => {
    const body = [
      "Thanks for the quote, looks good.",
      "Can you start next week?",
      "",
      "-- ",
      "Jackson Sweet | Canpro Deck & Rail",
      "250-555-0142",
      "jackson@canprodeckandrail.com",
    ].join("\n");
    expect(stripSignatureBlock(body)).toBe(
      "Thanks for the quote, looks good.\nCan you start next week?"
    );
  });

  it("strips a `--` (no trailing space) delimiter too", () => {
    const body = "See you then.\n\n--\nJackson Sweet\nCanpro";
    expect(stripSignatureBlock(body)).toBe("See you then.");
  });

  it("strips a `Sent from my iPhone` mobile footer", () => {
    const body = "Sounds great, go ahead.\n\nSent from my iPhone";
    expect(stripSignatureBlock(body)).toBe("Sounds great, go ahead.");
  });

  it("strips a `Get Outlook for iOS` footer", () => {
    const body = "Confirmed for Tuesday.\n\nGet Outlook for iOS";
    expect(stripSignatureBlock(body)).toBe("Confirmed for Tuesday.");
  });

  it("strips a closing-word sign-off (Thanks,) followed by a short name+contact block", () => {
    const body = [
      "Yes, please proceed with the cedar fence.",
      "",
      "Thanks,",
      "Jackson Sweet",
      "Canpro Deck & Rail",
      "250-555-0142",
    ].join("\n");
    expect(stripSignatureBlock(body)).toBe(
      "Yes, please proceed with the cedar fence."
    );
  });

  it("strips a `Regards,` sign-off block", () => {
    const body = "Looks good to me.\n\nRegards,\nMike Chen\nmike@example.com";
    expect(stripSignatureBlock(body)).toBe("Looks good to me.");
  });

  it("strips trailing labelled footer lines (Phone:/Address:)", () => {
    const body = [
      "We can meet at the site Thursday morning.",
      "",
      "Phone: 250-555-0142",
      "Address: 123 Industrial Way, Kelowna BC",
    ].join("\n");
    expect(stripSignatureBlock(body)).toBe(
      "We can meet at the site Thursday morning."
    );
  });

  it("leaves a body with no signature unchanged", () => {
    const body =
      "Hi, I'm looking for a quote on a 40ft cedar fence in my backyard. When can someone come take a look?";
    expect(stripSignatureBlock(body)).toBe(body);
  });

  it("does NOT remove the customer's actual message when a closing word appears mid-sentence", () => {
    const body =
      "Thanks for getting back to me so quickly. I had a few more questions about the timeline and materials before we lock anything in.";
    // "Thanks" here is conversational, not a sign-off — body must survive intact.
    expect(stripSignatureBlock(body)).toBe(body);
  });

  it("does not strip when the sign-off keyword is followed by a long paragraph (real content, not a name block)", () => {
    const body = [
      "Here's where we landed on scope.",
      "",
      "Best,",
      "I actually want to walk through the full material list and the staining options before you send a revised number, and I need to confirm the gate placement with my wife this weekend so hold tight on the final quote until I get back to you on Monday with those details.",
    ].join("\n");
    // The line after "Best," is clearly prose, not a signature name/contact block.
    expect(stripSignatureBlock(body)).toBe(body);
  });

  it("strips a long corporate signature with closure dates and business hours", () => {
    const body = [
      "Yes, the side-mounted black railing works for us.",
      "",
      "Kind regards,",
      "Alexis Solomon BA DID VISID",
      "OWNER | PRINCIPAL INTERIOR ARCHITECTURAL DESIGNER",
      "M I N T Freshly Inspired Design",
      "Please note our upcoming studio closure dates:",
      "August 17th to 21st",
      "December 11 to January 3rd",
      "Suite E - The Design Housse Collective",
      "587 Bay Street, Victoria BC V8T 1P5",
      "250-514-8203",
      "Business Hours: 9:00 am - 5:00 pm, Monday - Friday",
    ].join("\n");

    expect(stripSignatureBlock(body)).toBe(
      "Yes, the side-mounted black railing works for us."
    );
  });

  it("strips an extended corporate signature with social links and a land acknowledgement", () => {
    const body = [
      "Today would be great. The post has been removed.",
      "",
      "Kind regards,",
      "Alexis Solomon BA DID VISID",
      "OWNER | PRINCIPAL INTERIOR ARCHITECTURAL DESIGNER",
      "M I N T",
      "Freshly Inspired Design",
      "Please note our upcoming studio closure dates:",
      "August 17th to 21st",
      "December 11 to January 3rd",
      "Suite E - The Design Housse Collective",
      "587 Bay Street, Victoria BC V8T 1P5",
      "250-514-8203",
      "Business Hours: 9:00 am - 5:00 pm, Monday - Friday",
      "Closed Weekends & Holidays",
      "mintfreshlyinspireddesign.com",
      "WE'RE SOCIAL!",
      "Instagram | m.i.n.t_interior_design",
      "Facebook | MINT Freshly Inspired Design",
      "Make sure to follow our adventures within the Design Housse Collective!",
      "Instagram | The Design Housse Collective",
      "I acknowledge and am grateful to the local First Nations on whose traditional territory I live, work and raise my family.",
    ].join("\n");

    expect(stripSignatureBlock(body)).toBe(
      "Today would be great. The post has been removed."
    );
  });

  it("strips a collapsed inline name, phone, and company signature", () => {
    const body =
      "Feel free to text or call if anything changes.Jackson Sweet (250) 538-8994 Canpro Deck and Rail Victoria Inc.";

    expect(stripSignatureBlock(body)).toBe(
      "Feel free to text or call if anything changes."
    );
  });

  it("does not truncate authored acceptance after contact-shaped prose", () => {
    const body =
      "Please call me. John Smith 250-555-0142 is the company contact for this project. We accept the $1,200 quote.";

    expect(stripSignatureBlock(body)).toBe(body);
  });

  it("does not truncate authored commitment after an inline owner contact", () => {
    const body =
      "Here is the contact. Alex Jones alex@example.com is the owner for this project. Please proceed.";

    expect(stripSignatureBlock(body)).toBe(body);
  });

  it("does not let a hard signature delimiter erase a later commercial veto", () => {
    const body = [
      "We accept the quote.",
      "--",
      "Actually, we changed our minds and cancelled the project.",
    ].join("\n");

    expect(stripSignatureBlock(body)).toBe(body);
  });

  it("does not let a client footer erase a later payment reversal", () => {
    const body = [
      "The deposit was received.",
      "Sent from my iPhone",
      "Correction: the payment was reversed.",
    ].join("\n");

    expect(stripSignatureBlock(body)).toBe(body);
  });

  it("does not let a sign-off-shaped block erase a postscript cancellation", () => {
    const body = [
      "Go ahead with the project.",
      "Thanks,",
      "Alex Jones",
      "alex@example.com",
      "P.S. We changed our minds and cancelled the project.",
    ].join("\n");

    expect(stripSignatureBlock(body)).toBe(body);
  });

  it.each([
    "P.S. Removal excluded. Installation is $1,200.",
    "P.S. New total: $1,200.",
    "P.S. Friday works instead.",
    "P.S. Please add deck lighting for $500.",
  ])(
    "does not strip authored postscript facts after contact data: %s",
    (postscript) => {
      const body = [
        "We accept the $1,400 quote including removal.",
        "Thanks,",
        "Jane Doe",
        "jane@example.com",
        postscript,
      ].join("\n");

      expect(stripSignatureBlock(body)).toBe(body);
    }
  );

  it("does not let an extended corporate signature erase later authored schedule text", () => {
    const body = [
      "We accept the quote.",
      "Thanks,",
      "Jane Doe",
      "Owner, Acme Ltd.",
      "jane@example.com",
      "Friday is booked instead.",
    ].join("\n");

    expect(stripSignatureBlock(body)).toBe(body);
  });

  it("does not let an extended corporate signature erase an unclassified authored request", () => {
    const body = [
      "We accept the quote.",
      "Thanks,",
      "Jane Doe",
      "Owner, Acme Ltd.",
      "jane@example.com",
      "Please call when you have a chance.",
    ].join("\n");

    expect(stripSignatureBlock(body)).toBe(body);
  });

  it("does not treat authored schedule text containing a footer keyword as signature copy", () => {
    const body = [
      "We accept the quote.",
      "Thanks,",
      "Jane Doe",
      "Owner, Acme Ltd.",
      "jane@example.com",
      "I'm closed weekends, but Friday works.",
    ].join("\n");

    expect(stripSignatureBlock(body)).toBe(body);
  });

  it("does not treat authored text mentioning a corporate role as signature copy", () => {
    const body = [
      "We accept the quote.",
      "Thanks,",
      "Jane Doe",
      "Owner, Acme Ltd.",
      "jane@example.com",
      "Please call the project manager tomorrow.",
    ].join("\n");

    expect(stripSignatureBlock(body)).toBe(body);
  });

  it("does not erase authored text that appears before the final signature contact line", () => {
    const body = [
      "We accept the quote.",
      "Thanks,",
      "Jane Doe",
      "Please call when you have a chance.",
      "jane@example.com",
      "Owner, Acme Ltd.",
    ].join("\n");

    expect(stripSignatureBlock(body)).toBe(body);
  });

  it.each([
    "Friday works.",
    "New total is $1,200.",
    "Removal is excluded.",
    "Please send deposit details.",
  ])("keeps an ambiguous short authored line after a sign-off: %s", (line) => {
    const body = ["We accept the quote.", "Thanks,", line].join("\n");
    expect(stripSignatureBlock(body)).toBe(body);
  });

  it.each([
    "Sent from my bank account yesterday, the deposit is paid.",
    "Sent from my husband: revised total is $1,200.",
    "Sent via bank transfer; deposit paid.",
  ])(
    "does not mistake authored sent-language for a client footer: %s",
    (line) => {
      const body = ["We accept the quote.", line].join("\n");
      expect(stripSignatureBlock(body)).toBe(body);
    }
  );

  it("does not let a hard delimiter and signature erase a later postscript", () => {
    const body = [
      "We accept the quote.",
      "--",
      "Jane Doe",
      "jane@example.com",
      "P.S. Friday works instead.",
    ].join("\n");

    expect(stripSignatureBlock(body)).toBe(body);
  });

  it("returns empty string input unchanged", () => {
    expect(stripSignatureBlock("")).toBe("");
  });
});

describe("cleanMessageBody", () => {
  it("strips an `On … wrote:` quoted chain AND a `-- ` signature, leaving only the new reply", () => {
    const raw = [
      "Yes, let's go ahead with the 40ft cedar fence. Thanks for the quick turnaround.",
      "",
      "-- ",
      "Jackson Sweet | Canpro | 250-555-0142",
      "jackson@canprodeckandrail.com",
      "",
      "On Mon, Jun 23, 2026 at 3:45 PM Canpro Deck & Rail <jackson@canprodeckandrail.com> wrote:",
      "> Here's your quote for the 40ft cedar fence: $3,200.",
      "> Let me know if you'd like to proceed.",
      "> Thanks, Jackson",
    ].join("\n");
    expect(cleanMessageBody(raw, {})).toBe(
      "Yes, let's go ahead with the 40ft cedar fence. Thanks for the quick turnaround."
    );
  });

  it("prefers providerCleanBody (still signature-stripping it) when supplied", () => {
    const raw = "RAW BODY WITH WHOLE QUOTED CHAIN that we should ignore";
    const providerCleanBody = [
      "Confirmed, Thursday at 9am works.",
      "",
      "Sent from my iPhone",
    ].join("\n");
    expect(cleanMessageBody(raw, { providerCleanBody })).toBe(
      "Confirmed, Thursday at 9am works."
    );
  });

  it("falls back to quote-stripping the raw body when providerCleanBody is null", () => {
    const raw = [
      "Sounds good, see you then.",
      "",
      "On Mon, Jun 23, 2026 at 3:45 PM John Smith <john@example.com> wrote:",
      "> Can you make Thursday at 9?",
    ].join("\n");
    expect(cleanMessageBody(raw, { providerCleanBody: null })).toBe(
      "Sounds good, see you then."
    );
  });

  it("keeps only a short authored reply and never inherits quoted acceptance", () => {
    const raw = [
      "Thanks.",
      "",
      "On Mon, Jun 23, 2026 at 3:45 PM John Smith <john@example.com> wrote:",
      "> We accept the quote.",
      "> Please proceed.",
      "> The deposit was received.",
    ].join("\n");

    expect(cleanMessageBody(raw, { providerCleanBody: null })).toBe("Thanks.");
  });

  it("returns an empty lifecycle body for a quote-only reply", () => {
    const raw = [
      "On Mon, Jun 23, 2026 at 3:45 PM John Smith <john@example.com> wrote:",
      "> We accept the quote.",
      "> The deposit was received.",
      "> Installation is confirmed Tuesday.",
    ].join("\n");

    expect(cleanMessageBody(raw, { providerCleanBody: null })).toBe("");
  });

  it("strictly quote-strips provider-clean text before lifecycle use", () => {
    const providerCleanBody = [
      "OK.",
      "",
      "On Mon, Jun 23, 2026 at 3:45 PM John Smith <john@example.com> wrote:",
      "> Installation is confirmed Tuesday.",
      "> The payment was received.",
    ].join("\n");

    expect(cleanMessageBody("raw", { providerCleanBody })).toBe("OK.");
  });

  it("treats an explicit empty provider-clean body as authoritative", () => {
    const raw = [
      "On Mon, Jun 23, 2026 at 3:45 PM Canpro wrote:",
      "> We accept the estimate. Please proceed.",
    ].join("\n");
    expect(cleanMessageBody(raw, { providerCleanBody: "" })).toBe("");
  });

  it("strips cross-message overlap (a prior outbound body inlined verbatim into the reply)", () => {
    // The helper only fires when the inlined prior body lands in the LATTER
    // half of the reply (a real quoted chain sits below substantive new text),
    // so the reply paragraph is sized to push the overlap past the midpoint.
    const reply =
      "Looks great, please proceed with the project as quoted. We're ready to move forward and would like to get on the schedule as soon as possible, ideally within the next two weeks if your crew has availability then.";
    const prior =
      "Here is your detailed quote for the 40ft cedar fence project. The total comes to $3,200 including materials, labor, and removal of the existing fence. This price is valid for thirty days from today.";
    const raw = [reply, "", prior].join("\n");
    expect(cleanMessageBody(raw, { priorBodies: [prior] })).toBe(reply);
  });

  it("converts HTML, strips the quoted blockquote chain, and removes a signature", () => {
    const raw = [
      "<div>Yes, please proceed with the work.</div>",
      "<div>--</div>",
      "<div>Mike Chen</div>",
      "<div>mike@example.com</div>",
      '<blockquote class="gmail_quote">On Mon Jun 23 Canpro wrote: Your quote is $3,200.</blockquote>',
    ].join("\n");
    expect(cleanMessageBody(raw, {})).toBe(
      "Yes, please proceed with the work."
    );
  });

  it("returns empty string for empty input", () => {
    expect(cleanMessageBody("", {})).toBe("");
  });

  it("leaves a clean single-line customer inquiry untouched", () => {
    const raw =
      "Hi, do you install glass railings? I have a deck about 200 sqft. Thanks.";
    expect(cleanMessageBody(raw, {})).toBe(raw);
  });
});

describe("normalizeBodyLines", () => {
  it("collapses space-only lines so line-anchored heuristics can see blanks", () => {
    expect(normalizeBodyLines("a\n \n \t \nb")).toBe("a\n\nb");
  });

  it("removes zero-width, bidi, and BOM code points", () => {
    const body =
      "Please\u200Bconfirm\u200D the\u202E price\uFEFF today.";
    const cleaned = normalizeBodyLines(body);
    expect(INVISIBLE_CHARS_RE.test(cleaned)).toBe(false);
    expect(cleaned).toBe("Pleaseconfirm the price today.");
  });

  it("removes double-encoded invisible marks without eating mojibaked punctuation", () => {
    // "â€چ" / "â€Œ" are zero-width marks read back through a single-byte
    // codepage. "â€œ" and "â€”" are a mangled QUOTE and DASH — real text.
    expect(normalizeBodyLines("â€چ â€Œ Hi Jane, use PO 3934")).toBe(
      "  Hi Jane, use PO 3934"
    );
    expect(normalizeBodyLines("He said â€œyesâ€ â€” proceed.")).toBe(
      "He said â€œyesâ€ â€” proceed."
    );
  });

  it("collapses runs of blank lines to a single separator", () => {
    expect(normalizeBodyLines("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("returns empty input unchanged", () => {
    expect(normalizeBodyLines("")).toBe("");
  });
});

describe("stripOutlookReplyHeaderBlock", () => {
  it("drops a From:/Sent: header block and everything after it", () => {
    const body = [
      "Confirmed, thanks.",
      "",
      "From: Jackson Sweet <ops@example.com>",
      "Sent: Thursday, August 27, 2026 10:12 AM",
      "To: Jane Doe <jdoe@supplier.com>",
      "Subject: Re: PO Nelson Replacement",
      "",
      "Hi Jane, please use PO 3934 Jean Pl.",
    ].join("\n");
    expect(stripOutlookReplyHeaderBlock(body)).toBe("Confirmed, thanks.");
  });

  it("still fires when the header block omits To: and carries > prefixes", () => {
    const body = [
      "Sounds good.",
      "> From: Jackson Sweet <ops@example.com>",
      "> Date: Thu, 27 Aug 2026 10:12:00 -0700",
      "> Subject: PO Nelson Replacement",
    ].join("\n");
    expect(stripOutlookReplyHeaderBlock(body)).toBe("Sounds good.");
  });

  it("fires when a blank line separates From: from Sent:", () => {
    const body = [
      "Approved.",
      "From: Jackson Sweet <ops@example.com>",
      "",
      "Sent: Thursday, August 27, 2026 10:12 AM",
    ].join("\n");
    expect(stripOutlookReplyHeaderBlock(body)).toBe("Approved.");
  });

  it("does NOT truncate authored prose that merely starts with the word From", () => {
    const body =
      "From day one we planned to replace the whole railing, and the crew sent measurements last week.";
    expect(stripOutlookReplyHeaderBlock(body)).toBe(body);
  });

  it("does NOT truncate an unpaired From: line with no Sent:/Date: below it", () => {
    const body = [
      "Here is what we need.",
      "From: the site super, the gate has to swing inward.",
      "Please confirm before Friday.",
    ].join("\n");
    expect(stripOutlookReplyHeaderBlock(body)).toBe(body);
  });

  it("returns empty input unchanged", () => {
    expect(stripOutlookReplyHeaderBlock("")).toBe("");
  });
});

describe("Outlook contact-card and header artifacts (bug 7ca126d2)", () => {
  it("strips the card, the reply header, and the mojibake from a raw body", () => {
    expectVitrumArtifactsGone(cleanMessageBody(OUTLOOK_MANGLED, {}));
  });

  it("strips them from a stored provider-clean body too", () => {
    // `body_text_clean` rows written before this fix keep every artifact at
    // rest forever, and both the classifier and the summary service read them.
    expectVitrumArtifactsGone(
      cleanMessageBody("RAW", { providerCleanBody: OUTLOOK_MANGLED })
    );
  });

  it("strips them through the summary-evidence sanitizer", () => {
    expectVitrumArtifactsGone(sanitizeSummaryEvidenceBody(OUTLOOK_MANGLED));
  });

  it("strips a pipe-delimited contact card with no sign-off word above it", () => {
    const body = [
      "Yes, the order is confirmed.",
      "",
      "JANE DOE | INSIDE SALES REP | ",
      "jdoe@supplier.com",
      "T: 604-555-3513 ext. 8723 | ",
      "www.supplier.ca",
    ].join("\n");
    expect(stripSignatureBlock(normalizeBodyLines(body))).toBe(
      "Yes, the order is confirmed."
    );
  });

  it("strips a single-line self-contained contact card at the end", () => {
    const body = [
      "The glass ships Tuesday.",
      "JANE DOE | INSIDE SALES REP | jdoe@supplier.com | T: 604-555-3513",
    ].join("\n");
    expect(stripSignatureBlock(body)).toBe("The glass ships Tuesday.");
  });

  it("does NOT cut an authored sentence that contains a pipe and capitals", () => {
    const body = [
      "We accept the quote.",
      "PLEASE NOTE | the gate swing has to change before you order.",
      "Friday still works for the install.",
    ].join("\n");
    expect(stripSignatureBlock(body)).toBe(body);
  });

  it("never blanks a message that is nothing but a contact card", () => {
    const body = [
      "JANE DOE | INSIDE SALES REP | ",
      "jdoe@supplier.com",
      "T: 604-555-3513",
    ].join("\n");
    expect(stripSignatureBlock(body)).toBe(body);
  });

  it("does not let a contact card erase a later commercial veto", () => {
    const body = [
      "The order is placed.",
      "JANE DOE | INSIDE SALES REP | ",
      "jdoe@supplier.com",
      "Actually, we changed our minds and cancelled the project.",
    ].join("\n");
    expect(stripSignatureBlock(body)).toBe(body);
  });
});
