import { describe, expect, it } from "vitest";

import { stripForwardWrapper } from "../forward-wrapper";

/**
 * The exact shape that caused the impersonation incident: a Wix contact-form
 * notification forwarded from the operator's phone. The forwarder's own iPhone
 * signature sits ABOVE the forward marker, so a model reading the raw body
 * signs the reply as the forwarder instead of the mailbox owner.
 */
const REAL_FORWARDED_SUBMISSION = [
  "Thanks,Jared Jerome ",
  "778-268-3324",
  "Canpro Deck and Rail",
  "",
  "Sent from my iPhone",
  "",
  "Begin forwarded message:",
  "",
  "From: Canpro Deck and Rail <notifications@wix-forms.com>",
  "Date: August 2, 2026 at 11:41:10 MDT",
  "To: jared@canprodeckandrail.com",
  "Subject: Free Quote form got a new submission",
  'Reply-To: "molsonc2020@gmail.com" <molsonc2020@gmail.com>',
  "",
  "A site visitor just submitted your form Free Quote form on canpro-deck-and-rail",
  "Submission summary:",
  "Name:",
  "Carolyn Molson ",
  "Phone Number:",
  "7809825181 ",
  "Email Address:",
  "molsonc2020@gmail.com ",
  "Location:",
  "Esquimalt ",
  "How Can We Help?:",
  "Hello,",
  "I would like a quote for a front deck. I have a picture for a starting point...",
].join("\n");

describe("stripForwardWrapper", () => {
  it("removes the forwarder's signature block from a real forwarded submission", () => {
    const stripped = stripForwardWrapper(REAL_FORWARDED_SUBMISSION);

    // The forwarder's identity is gone — this is the impersonation source.
    expect(stripped).not.toContain("Jared Jerome");
    expect(stripped).not.toContain("778-268-3324");
    expect(stripped).not.toContain("Sent from my iPhone");
    expect(stripped).not.toMatch(/^Thanks,/m);

    // Everything from the marker onward survives byte-for-byte.
    expect(stripped.startsWith("Begin forwarded message:")).toBe(true);
    expect(stripped).toContain("Carolyn Molson");
    expect(stripped).toContain("molsonc2020@gmail.com");
    expect(stripped).toContain(
      "I would like a quote for a front deck. I have a picture for a starting point..."
    );
    expect(stripped).toContain("Reply-To:");
  });

  it("preserves a real note from the forwarder above the signature block", () => {
    const withNote = [
      "Quote this one high — busy month.",
      "",
      REAL_FORWARDED_SUBMISSION,
    ].join("\n");

    const stripped = stripForwardWrapper(withNote);

    expect(stripped.startsWith("Quote this one high — busy month.")).toBe(true);
    expect(stripped).not.toContain("Jared Jerome");
    expect(stripped).not.toContain("778-268-3324");
    expect(stripped).not.toContain("Canpro Deck and Rail\n");
    expect(stripped).not.toContain("Sent from my iPhone");
    expect(stripped).toContain("Begin forwarded message:");
    expect(stripped).toContain("Carolyn Molson");
  });

  it("handles the Gmail-web forward marker variant", () => {
    const gmailWeb = [
      "Cheers",
      "Dana Whitfield",
      "250-555-0134",
      "",
      "Sent from my Galaxy",
      "",
      "---------- Forwarded message ---------",
      "From: Website Forms <forms@example.com>",
      "",
      "Name: Peter Vance",
      "Message: Need a railing quote for a 40ft deck.",
    ].join("\n");

    const stripped = stripForwardWrapper(gmailWeb);

    expect(stripped).not.toContain("Dana Whitfield");
    expect(stripped).not.toContain("250-555-0134");
    expect(stripped).not.toContain("Sent from my Galaxy");
    expect(stripped.startsWith("---------- Forwarded message ---------")).toBe(
      true
    );
    expect(stripped).toContain("Peter Vance");
    expect(stripped).toContain("Need a railing quote for a 40ft deck.");
  });

  it("returns text without a forward marker unchanged", () => {
    const direct = [
      "Hi there,",
      "",
      "I'd like a quote for a new deck.",
      "",
      "Thanks,",
      "Carolyn Molson",
      "780-982-5181",
      "",
      "Sent from my iPhone",
    ].join("\n");

    expect(stripForwardWrapper(direct)).toBe(direct);
  });

  it("returns forwarded text unchanged when no device footer precedes the marker", () => {
    const noDeviceFooter = [
      "Passing this along.",
      "",
      "Begin forwarded message:",
      "",
      "Name: Peter Vance",
    ].join("\n");

    expect(stripForwardWrapper(noDeviceFooter)).toBe(noDeviceFooter);
  });

  it("falls back to the short-line run when no closing word precedes the device line", () => {
    const noClosing = [
      "Please handle today.",
      "",
      "Jared Jerome",
      "778-268-3324",
      "Canpro Deck and Rail",
      "",
      "Sent from my iPhone",
      "",
      "Begin forwarded message:",
      "",
      "Name: Carolyn Molson",
    ].join("\n");

    const stripped = stripForwardWrapper(noClosing);

    expect(stripped.startsWith("Please handle today.")).toBe(true);
    expect(stripped).not.toContain("Jared Jerome");
    expect(stripped).not.toContain("778-268-3324");
    expect(stripped).not.toContain("Sent from my iPhone");
    expect(stripped).toContain("Begin forwarded message:");
    expect(stripped).toContain("Carolyn Molson");
  });

  it("does not eat prose that merely opens with a closing word", () => {
    const proseThanks = [
      "Thanks for chasing this one down for me yesterday.",
      "",
      "Jared Jerome",
      "",
      "Sent from my iPhone",
      "",
      "Begin forwarded message:",
      "",
      "Name: Carolyn Molson",
    ].join("\n");

    const stripped = stripForwardWrapper(proseThanks);

    expect(stripped.startsWith("Thanks for chasing this one down for me")).toBe(
      true
    );
    expect(stripped).not.toContain("Jared Jerome");
    expect(stripped).not.toContain("Sent from my iPhone");
  });

  it("returns empty and blank input unchanged", () => {
    expect(stripForwardWrapper("")).toBe("");
    expect(stripForwardWrapper("   \n  ")).toBe("   \n  ");
  });
});
