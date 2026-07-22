import { describe, it, expect } from "vitest";
import {
  cleanMessageBody,
  stripSignatureBlock,
} from "@/lib/api/services/conversation-state/message-cleaner";

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
