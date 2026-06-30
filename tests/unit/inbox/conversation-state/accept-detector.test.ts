/**
 * Coverage for the deterministic won/accepted detector that runs BEFORE any AI
 * (docs/inbox/clean-state-layer-spec.md, Phase 2 + the "accept → split by
 * confidence" product decision). The detector's whole job is to stop "clear won
 * language missed": an explicit "yes, go ahead" or a customer-attached signed
 * estimate is HIGH confidence (auto-advance to Won), while soft/ambiguous
 * acknowledgements ("sounds good", "ok") are LOW confidence (one-tap Mark Won).
 *
 * Pure core only — `detectAccept(customerMessages)` takes already-cleaned
 * CleanMessage[] and returns an AcceptSignal. No DB, no network, no model.
 */

import { describe, expect, it } from "vitest";
import {
  detectAccept,
  ACCEPT_LANGUAGE_PATTERNS,
  SOFT_ACK_PATTERNS,
  SIGNED_ESTIMATE_FILENAME_PATTERNS,
} from "@/lib/api/services/conversation-state/accept-detector";
import type {
  AttachmentInspection,
  AttachmentRef,
  CleanMessage,
} from "@/lib/api/services/conversation-state/types";

const ISO = "2026-06-20T15:00:00.000Z";

function makeAttachment(overrides: Partial<AttachmentRef> = {}): AttachmentRef {
  return {
    filename: "photo.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 120_000,
    kind: "image",
    requiresInspection: true,
    inspection: null,
    ...overrides,
  };
}

function makeSignedInspection(
  overrides: Partial<AttachmentInspection> = {},
): AttachmentInspection {
  return {
    summary: "Signed estimate — 40ft cedar fence, total $3,200, customer signature present.",
    isSignedEstimate: true,
    facts: {},
    model: "gpt-5.4",
    ...overrides,
  };
}

/**
 * Factory for a real customer inbound CleanMessage. Defaults to the shape the
 * detector cares about: inbound + customer + isRealCustomerInbound. Tests
 * override `cleanBody` / `attachments` per case.
 */
function makeCustomerMessage(overrides: Partial<CleanMessage> = {}): CleanMessage {
  return {
    providerMessageId: "msg-1",
    direction: "inbound",
    partyRole: "customer",
    fromEmail: "client@example.com",
    fromName: "Dana Reyes",
    sentAt: ISO,
    cleanBody: "",
    rawBody: "",
    isRealCustomerInbound: true,
    attachments: [],
    ...overrides,
  };
}

describe("detectAccept — high confidence", () => {
  it("flags explicit accept language AND a signed-estimate attachment with both bases", () => {
    // The canonical 'clear win': a plain yes plus the inspected, signed PDF.
    const msg = makeCustomerMessage({
      providerMessageId: "msg-accept",
      cleanBody: "Yes, let's go ahead — signed estimate attached.",
      attachments: [
        makeAttachment({
          filename: "Estimate-signed.pdf",
          mimeType: "application/pdf",
          kind: "pdf",
          inspection: makeSignedInspection(),
        }),
      ],
    });

    const signal = detectAccept([msg]);

    expect(signal.detected).toBe(true);
    expect(signal.confidence).toBe("high");
    expect(signal.basis).toContain("explicit_accept_language");
    expect(signal.basis).toContain("signed_estimate_attachment");
    expect(signal.evidenceMessageIds).toEqual(["msg-accept"]);
  });

  it("flags explicit accept language alone as high confidence", () => {
    const variants = [
      "Yes let's proceed.",
      "We accept the quote.",
      "Approved — please send the contract.",
      "Go ahead and book it.",
      "Let's do it.",
      "You're hired.",
    ];
    for (const cleanBody of variants) {
      const signal = detectAccept([makeCustomerMessage({ cleanBody })]);
      expect(signal.detected, cleanBody).toBe(true);
      expect(signal.confidence, cleanBody).toBe("high");
      expect(signal.basis, cleanBody).toContain("explicit_accept_language");
    }
  });

  it("flags an inspected signed-estimate attachment as high confidence even with a neutral body", () => {
    const msg = makeCustomerMessage({
      providerMessageId: "msg-sig-only",
      cleanBody: "Here you go.",
      attachments: [
        makeAttachment({
          filename: "quote.pdf",
          mimeType: "application/pdf",
          kind: "pdf",
          inspection: makeSignedInspection(),
        }),
      ],
    });

    const signal = detectAccept([msg]);

    expect(signal.detected).toBe(true);
    expect(signal.confidence).toBe("high");
    expect(signal.basis).toEqual(["signed_estimate_attachment"]);
    expect(signal.evidenceMessageIds).toEqual(["msg-sig-only"]);
  });
});

describe("detectAccept — low confidence (soft / pre-vision)", () => {
  it("treats a bare 'sounds good' as low confidence verbal_soft", () => {
    const signal = detectAccept([
      makeCustomerMessage({ providerMessageId: "msg-soft", cleanBody: "sounds good" }),
    ]);

    expect(signal.detected).toBe(true);
    expect(signal.confidence).toBe("low");
    expect(signal.basis).toEqual(["verbal_soft"]);
    expect(signal.evidenceMessageIds).toEqual(["msg-soft"]);
  });

  it("treats other soft acknowledgements as low confidence verbal_soft", () => {
    for (const cleanBody of ["ok", "great", "okay thanks", "Great, thanks!"]) {
      const signal = detectAccept([makeCustomerMessage({ cleanBody })]);
      expect(signal.detected, cleanBody).toBe(true);
      expect(signal.confidence, cleanBody).toBe("low");
      expect(signal.basis, cleanBody).toContain("verbal_soft");
    }
  });

  it("treats an un-inspected estimate-named customer PDF as a LOW signed_estimate hint (pre-vision)", () => {
    // inspection === null (vision step has not run). A customer-inbound PDF whose
    // filename matches an estimate/quote/signed pattern is a soft hint, NOT a
    // high-confidence accept — vision must confirm the signature first.
    const msg = makeCustomerMessage({
      providerMessageId: "msg-pdf-hint",
      cleanBody: "see attached",
      attachments: [
        makeAttachment({
          filename: "Signed-Estimate-1042.pdf",
          mimeType: "application/pdf",
          kind: "pdf",
          inspection: null,
        }),
      ],
    });

    const signal = detectAccept([msg]);

    expect(signal.detected).toBe(true);
    expect(signal.confidence).toBe("low");
    expect(signal.basis).toContain("signed_estimate_attachment");
    expect(signal.evidenceMessageIds).toEqual(["msg-pdf-hint"]);
  });
});

describe("detectAccept — no signal", () => {
  it("returns detected=false for an unrelated question", () => {
    const signal = detectAccept([
      makeCustomerMessage({
        providerMessageId: "msg-q",
        cleanBody: "Do you have availability next Tuesday for a site visit?",
      }),
    ]);

    expect(signal.detected).toBe(false);
    expect(signal.basis).toEqual([]);
    expect(signal.evidenceMessageIds).toEqual([]);
  });

  it("returns detected=false for an empty customer-message list", () => {
    const signal = detectAccept([]);
    expect(signal.detected).toBe(false);
    expect(signal.basis).toEqual([]);
    expect(signal.evidenceMessageIds).toEqual([]);
  });

  it("ignores an un-inspected PDF whose filename does not look like an estimate", () => {
    const msg = makeCustomerMessage({
      cleanBody: "Photos from the site.",
      attachments: [
        makeAttachment({
          filename: "site-photos.pdf",
          mimeType: "application/pdf",
          kind: "pdf",
          inspection: null,
        }),
      ],
    });
    const signal = detectAccept([msg]);
    expect(signal.detected).toBe(false);
  });
});

describe("detectAccept — multi-message + precedence", () => {
  it("high confidence wins when one message accepts and an earlier one is only soft", () => {
    const soft = makeCustomerMessage({
      providerMessageId: "m-soft",
      sentAt: "2026-06-18T10:00:00.000Z",
      cleanBody: "sounds good",
    });
    const hard = makeCustomerMessage({
      providerMessageId: "m-hard",
      sentAt: "2026-06-19T10:00:00.000Z",
      cleanBody: "Great — go ahead and book it.",
    });

    const signal = detectAccept([soft, hard]);

    expect(signal.confidence).toBe("high");
    expect(signal.basis).toContain("explicit_accept_language");
    // Only the high-confidence message carries the win; the soft one is not evidence.
    expect(signal.evidenceMessageIds).toEqual(["m-hard"]);
    expect(signal.basis).not.toContain("verbal_soft");
  });

  it("collects evidence ids across multiple soft messages when no hard accept exists", () => {
    const signal = detectAccept([
      makeCustomerMessage({ providerMessageId: "m1", cleanBody: "ok" }),
      makeCustomerMessage({ providerMessageId: "m2", cleanBody: "great thanks" }),
    ]);
    expect(signal.confidence).toBe("low");
    expect(signal.basis).toEqual(["verbal_soft"]);
    expect(signal.evidenceMessageIds).toEqual(["m1", "m2"]);
  });
});

describe("exported keyword/pattern lists are present for tuning", () => {
  it("exports non-empty pattern lists", () => {
    expect(ACCEPT_LANGUAGE_PATTERNS.length).toBeGreaterThan(0);
    expect(SOFT_ACK_PATTERNS.length).toBeGreaterThan(0);
    expect(SIGNED_ESTIMATE_FILENAME_PATTERNS.length).toBeGreaterThan(0);
  });
});
