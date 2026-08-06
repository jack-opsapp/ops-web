/**
 * Unit tests — outboundBodyDerivedFromDraft
 *
 * Regression cover for bug be648d50: five Phase C drafts the operator sent from
 * Gmail on 2026-08-06 were filed `superseded` instead of `sent_from_mailbox`,
 * because reconciliation inferred authorship purely from whether the provider
 * draft object still existed and never looked at what was actually sent.
 *
 * The bodies below are the real production rows (company
 * a612edc0-5c18-4c4d-af97-55b9410dd077). Positives are draft -> the message the
 * operator actually sent in that same thread. Negatives are the same operator's
 * unrelated real sends: same voice, same stock openers, same signature — the
 * hardest realistic false-positive case.
 */

import { describe, it, expect } from "vitest";
import {
  outboundBodyDerivedFromDraft,
  DRAFT_DERIVATION_MIN_VERBATIM_RUN,
} from "@/lib/api/services/draft-reconciliation";

// ── real production drafts (ai_draft_history.original_draft) ────────────────
const DRAFT_STEVE =
  "Hi Steve,\n\nHope you’re doing well, and thanks for reaching out again.\n\n" +
  "We’d be happy to take a look at the front deck repair at Tanner Ridge. Early next week should work, and I think meeting on site in Central Saanich makes the most sense.\n\n" +
  "If Monday is best for you, send me a time that works and we can set it up. If another day early next week is better, that works too.\n\nThanks,";

const DRAFT_KEN =
  "Hi Ken,\n\nHope you’re doing well. Thanks for reaching out about the deck railings in Colwood.\n\n" +
  "We’d be happy to help with a quote and go over the options available. There are usually a few good railing choices depending on the look you want and the layout of the deck.\n\n" +
  "The next step is to take a look at the space and get a bit more info on the project. If you want, you can send over a few photos of the deck along with any rough measurements, and I can maybe point you in the right direction before we set up a site visit.\n\n" +
  "If that works for you, send those through and we can go from there.\n\nThanks,";

const DRAFT_KARAN =
  "Hi Karan,\n\nHope your weekend’s going well.\n\n" +
  "Thanks for reaching out about the backyard project. I saw you’re looking at a 9 ft x 17 ft deck and about 72 ft of fencing in Langford.\n\n" +
  "The next step would be to set up a time to come by and have a look. That way we can go over the layout, materials, and access, and I can maybe put together an accurate quote for you.\n\n" +
  "If you want, just reply with a couple of times that work for you this week and we can get something lined up.\n\nThanks,";

// ── real production sends (activities.body_text) ────────────────────────────
const SIGNATURE =
  "All the best,\r\n\r\nJackson\r\n\r\n[image: Canpro Deck and Rail]\r\nJackson Sweet\r\n" +
  "Canpro Deck and Rail\r\n(250) 538-8994 · www.canprodeckandrail.com\r\n";

const SENT_STEVE =
  "Hi Steve,\r\n\r\nHope you’re doing well, and thanks for reaching out again.\r\n\r\n" +
  "Happy to take a look at the front deck repair at Tanner Ridge. If you have\r\nany dimensions and photos to share, I could likely get you an idea of\r\n" +
  "pricing within the next day or two. We can also book a site visit for\r\nFriday if you are available late morning.\r\n\r\n" +
  SIGNATURE;

const SENT_KEN =
  "Hi Ken,\r\n\r\nHope you’re doing well. Thanks for reaching out about your railings project!\r\n\r\n" +
  "Happy to put together some pricing for you- we can offer matte black or\r\ngloss white, and we do either glass or picket.\r\n\r\n" +
  "If you can share any photos and dimensions of the space, as well as any\r\nother details in mind, please go ahead, and from there I can put together\r\n" +
  "some pricing for you. If you'd like to set up a site visit, happy to book\r\nsomething for early next week.\r\n\r\n" +
  SIGNATURE;

const SENT_KARAN =
  "Hi Karan,\r\n\r\nHope your week’s going well.\r\n\r\n" +
  "Thanks for reaching out about the backyard project. I saw you’re looking at\r\na 9 ft x 17 ft deck and about 72 ft of fencing in Langford.\r\n\r\n" +
  "Are you able to send over a few photos and any more details about the job?\r\nI'll see if I can put together a ballpark estimate for you, and from there\r\n" +
  "we can book a site visit to go over everything together if you'd like.\r\n\r\n" +
  SIGNATURE;

// An unrelated real send by the same operator — same voice, same signature.
const SENT_UNRELATED =
  "Hi Jill,\r\n\r\nJust following up here- did you have any questions about the quote?\r\n\r\n" +
  "Let me know if there's anything we can help with.\r\n\r\nCheers\r\nJackson\r\n";

describe("outboundBodyDerivedFromDraft", () => {
  // ── positives: the five real rows bug be648d50 mis-filed ─────────────────
  it("proves derivation when the operator edited our draft and sent it (Steve)", () => {
    expect(
      outboundBodyDerivedFromDraft({
        draftBody: DRAFT_STEVE,
        sentBody: SENT_STEVE,
        subject: "Canpro Deck and Rail Estimate",
      })
    ).toBe(true);
  });

  it("proves derivation on the heaviest real rewrite (Ken)", () => {
    expect(
      outboundBodyDerivedFromDraft({
        draftBody: DRAFT_KEN,
        sentBody: SENT_KEN,
        subject: "Canpro Deck and Rail Estimate",
      })
    ).toBe(true);
  });

  it("proves derivation when whole paragraphs survive verbatim (Karan)", () => {
    expect(
      outboundBodyDerivedFromDraft({
        draftBody: DRAFT_KARAN,
        sentBody: SENT_KARAN,
        subject: "Canpro Deck and Rail Estimate",
      })
    ).toBe(true);
  });

  it("proves derivation when the operator rewrote the middle (Gillian)", () => {
    expect(
      outboundBodyDerivedFromDraft({
        draftBody:
          "Hi Gillian,\n\nHope you’re having a good weekend.\n\n" +
          "Thanks for reaching out about replacing your current vinyl decking in Brentwood Bay. We do that type of work and I’d be happy to take a look at it.\n\n" +
          "The next step would be to set up a time to come by and see the existing deck, then we can talk through options and what the replacement would involve. If you want, send over a couple of days and times that work for you, and I’ll see what I can line up.\n\nThanks,",
        sentBody:
          "Hi Gillian,\r\n\r\nHope you’re having a good week!\r\n\r\n" +
          "Thanks for reaching out about replacing your current vinyl decking in\r\nBrentwood Bay. I’d be happy to take a look at your project and set you up\r\nwith some numbers.\r\n\r\n" +
          "If you're able to send over a few photos and measurements, I could put\r\ntogether an estimate of the costs for you based on that. From there, we can\r\nbook a site visit if you'd like to go over everything together.\r\n\r\n" +
          SIGNATURE,
        subject: "Canpro Deck and Rail Estimate",
      })
    ).toBe(true);
  });

  it("proves derivation on a lightly edited send (Carolyn)", () => {
    expect(
      outboundBodyDerivedFromDraft({
        draftBody:
          "Hi Carolyn,\n\nHope you’re having a good week.\n\n" +
          "Thanks for reaching out about the front deck. That sounds like a good place to start, and I’d be happy to take a look at the picture you have and hear more about the end goal as well. We can definitely give feedback and help point things in the right direction.\n\n" +
          "The best next step is to send over the photo when you get a chance, and maybe any rough dimensions or a couple more details about what you’re hoping to do. From there, I think we can figure out whether it makes sense to set up a site visit and put a quote together.\n\n" +
          "Send those through when you can, and we’ll go from there!\n\nThanks,",
        sentBody:
          "Hi Carolyn,\r\n\r\nHope you’re having a good week!\r\n\r\n" +
          "Thanks for reaching out about the front deck. That sounds like a good place\r\nto start, and I’d be happy to take a look at the pictures you have and hear\r\nmore about the end goal as well. We can definitely give feedback and help\r\npoint things in the right direction.\r\n\r\n" +
          "The best next step is to send over the photos when you get a chance, and\r\nany dimensions or other details about what you’re hoping to do. From there,\r\nI could put together some rough numbers, and book a site visit.\r\n\r\n" +
          "Send those through when you can, and we’ll go from there!\r\n\r\n" +
          SIGNATURE,
        subject: "Canpro Deck and Rail Estimate",
      })
    ).toBe(true);
  });

  it("treats an unedited send as derived", () => {
    expect(
      outboundBodyDerivedFromDraft({
        draftBody: DRAFT_STEVE,
        sentBody: DRAFT_STEVE,
        subject: "Canpro Deck and Rail Estimate",
      })
    ).toBe(true);
  });

  // ── negatives: same operator, same template voice, different customer ────
  it("rejects a different customer's reply written in the same stock voice", () => {
    expect(
      outboundBodyDerivedFromDraft({
        draftBody: DRAFT_KARAN,
        sentBody: SENT_KEN,
        subject: "Canpro Deck and Rail Estimate",
      })
    ).toBe(false);
  });

  it("rejects a same-voice send that shares only the operator's stock opener", () => {
    expect(
      outboundBodyDerivedFromDraft({
        draftBody: DRAFT_STEVE,
        sentBody: SENT_KEN,
        subject: "Canpro Deck and Rail Estimate",
      })
    ).toBe(false);
  });

  it("rejects an unrelated send by the same operator", () => {
    expect(
      outboundBodyDerivedFromDraft({
        draftBody: DRAFT_KEN,
        sentBody: SENT_UNRELATED,
        subject: "Re: Canpro Deck and Rail Estimate",
      })
    ).toBe(false);
  });

  it("does not count our own draft text quoted back inside the reply", () => {
    // The operator wrote something new but Gmail quoted our earlier message
    // underneath. Quoted content is not authorship evidence.
    const quotedReply =
      "Sounds good, I will call you tomorrow.\r\n\r\nCheers\r\nJackson\r\n\r\n" +
      "On Wed, Aug 5, 2026 at 5:22 PM Jackson Sweet <canprojack@gmail.com> wrote:\r\n\r\n" +
      DRAFT_STEVE.split("\n")
        .map((line) => `> ${line}`)
        .join("\r\n");
    expect(
      outboundBodyDerivedFromDraft({
        draftBody: DRAFT_STEVE,
        sentBody: quotedReply,
        subject: "Re: Canpro Deck and Rail Estimate",
      })
    ).toBe(false);
  });

  // ── degenerate inputs ───────────────────────────────────────────────────
  it("returns false when either body is missing", () => {
    expect(
      outboundBodyDerivedFromDraft({
        draftBody: "",
        sentBody: SENT_STEVE,
        subject: "x",
      })
    ).toBe(false);
    expect(
      outboundBodyDerivedFromDraft({
        draftBody: DRAFT_STEVE,
        sentBody: "",
        subject: "x",
      })
    ).toBe(false);
  });

  it("returns false when a draft is nothing but the stock greeting and sign-off", () => {
    expect(
      outboundBodyDerivedFromDraft({
        draftBody: "Hi Steve,\n\nThanks,",
        sentBody: SENT_STEVE,
        subject: "x",
      })
    ).toBe(false);
  });

  it("exposes the measured verbatim-run threshold", () => {
    // Chosen from the real corpus: 5 true pairs scored 54/64/86/151/174, while
    // 245 same-operator negative pairs topped out at 45. 50 is the midpoint.
    expect(DRAFT_DERIVATION_MIN_VERBATIM_RUN).toBe(50);
  });
});
