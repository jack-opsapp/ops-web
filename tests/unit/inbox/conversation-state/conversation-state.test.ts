import { describe, it, expect } from "vitest";

import { assembleConversationState } from "@/lib/api/services/conversation-state/conversation-state";
import type {
  AssembleConversationStateInput,
  RawThreadMessage,
} from "@/lib/api/services/conversation-state/conversation-state";
import type { OperatorIdentity } from "@/lib/api/services/conversation-state/types";

// ─────────────────────────────────────────────────────────────────────────────
// conversation-state orchestrator — PURE CORE (`assembleConversationState`)
//
// The orchestrator composes the already-tested deterministic modules
// (message-cleaner, party-classifier, contact-resolver, accept-detector,
// sent-ledger, router) into one ConversationState. These tests assemble plain
// inputs inline — NO DB, NO mocks — exactly like the module-level suites.
//
// The operator fixture is intentionally a PURE-GMAIL operator (empty `domains`)
// so the keystone path — "a gmail operator must not swallow gmail customers" —
// is exercised end-to-end through the real composed modules.
// ─────────────────────────────────────────────────────────────────────────────

const operator: OperatorIdentity = {
  emails: new Set(["canprojack@gmail.com"]),
  domains: new Set<string>(), // pure-gmail operator → no private domain
  phones: new Set(["2505550000"]), // Canpro's own office line (normalized digits)
  addresses: new Set(["1200 industrial way victoria bc"]),
  companyName: "Canpro Deck and Rail",
};

function rawMsg(over: Partial<RawThreadMessage> = {}): RawThreadMessage {
  return {
    providerMessageId: "m1",
    fromEmail: "sarah@gmail.com",
    fromName: "Sarah Lee",
    toEmails: ["canprojack@gmail.com"],
    ccEmails: [],
    subject: "Fence quote",
    sentAt: "2026-06-20T15:00:00.000Z",
    rawBody: "Hi, I'd like a quote for a 40ft cedar fence at 12 Oak St.",
    providerCleanBody: null,
    attachments: [],
    ...over,
  };
}

function baseInput(
  over: Partial<AssembleConversationStateInput> = {}
): AssembleConversationStateInput {
  return {
    threadId: "thread-uuid-1",
    connectionId: "conn-1",
    companyId: "co-1",
    operator,
    rawMessages: [rawMsg()],
    stage: "new_lead",
    contactFormSubmitter: null,
    commitments: [],
    ...over,
  };
}

describe("assembleConversationState — keystone (gmail operator vs gmail customer)", () => {
  it("classifies a gmail customer as customer and the gmail operator as operator", () => {
    const state = assembleConversationState(
      baseInput({
        rawMessages: [
          rawMsg({
            providerMessageId: "c1",
            fromEmail: "sarah@gmail.com",
            fromName: "Sarah Lee",
            sentAt: "2026-06-20T15:00:00.000Z",
            rawBody: "Hi, I'd like a quote for a cedar fence.",
          }),
          rawMsg({
            providerMessageId: "o1",
            fromEmail: "canprojack@gmail.com",
            fromName: "Jack",
            toEmails: ["sarah@gmail.com"],
            sentAt: "2026-06-20T16:00:00.000Z",
            rawBody: "Thanks Sarah, I'll put a quote together.",
          }),
        ],
      })
    );

    const cust = state.messages.find((m) => m.providerMessageId === "c1")!;
    const op = state.messages.find((m) => m.providerMessageId === "o1")!;

    expect(cust.direction).toBe("inbound");
    expect(cust.partyRole).toBe("customer");
    expect(cust.isRealCustomerInbound).toBe(true);

    expect(op.direction).toBe("outbound");
    expect(op.partyRole).toBe("operator");
    expect(op.isRealCustomerInbound).toBe(false);

    expect(state.customerMessages).toHaveLength(1);
    expect(state.customerMessages[0].providerMessageId).toBe("c1");
  });
});

describe("assembleConversationState — message ordering & recipient", () => {
  it("orders messages chronologically regardless of input order", () => {
    const state = assembleConversationState(
      baseInput({
        rawMessages: [
          rawMsg({ providerMessageId: "c2", sentAt: "2026-06-21T10:00:00.000Z", rawBody: "second" }),
          rawMsg({ providerMessageId: "c1", sentAt: "2026-06-20T10:00:00.000Z", rawBody: "first" }),
        ],
      })
    );
    expect(state.messages.map((m) => m.providerMessageId)).toEqual(["c1", "c2"]);
  });

  it("binds recipient to the actual latest inbound sender (not the first)", () => {
    const state = assembleConversationState(
      baseInput({
        rawMessages: [
          rawMsg({
            providerMessageId: "c1",
            fromEmail: "old@gmail.com",
            fromName: "Old Sender",
            sentAt: "2026-06-20T10:00:00.000Z",
            rawBody: "First contact.",
          }),
          rawMsg({
            providerMessageId: "c2",
            fromEmail: "sarah@gmail.com",
            fromName: "Sarah Lee",
            sentAt: "2026-06-21T10:00:00.000Z",
            rawBody: "Following up on my request.",
          }),
        ],
      })
    );
    expect(state.recipient.email).toBe("sarah@gmail.com");
    expect(state.recipient.name).toBe("Sarah Lee");
  });
});

describe("assembleConversationState — clean body", () => {
  it("removes the quoted reply chain and the trailing signature", () => {
    const raw = [
      "Sounds good, please send the contract.",
      "",
      "Thanks,",
      "Sarah Lee",
      "778-555-9999",
      "",
      "On Mon, Jun 20, 2026 at 9:00 AM Jack <canprojack@gmail.com> wrote:",
      "> Here is your quote for $3,200.",
    ].join("\n");

    const state = assembleConversationState(
      baseInput({ rawMessages: [rawMsg({ providerMessageId: "c1", rawBody: raw })] })
    );

    const m = state.messages[0];
    expect(m.cleanBody).toContain("Sounds good");
    expect(m.cleanBody).not.toMatch(/On Mon/);
    expect(m.cleanBody).not.toContain("$3,200");
    expect(m.cleanBody).not.toContain("778-555-9999"); // signature dropped
    expect(m.rawBody).toContain("$3,200"); // raw retained for audit
  });

  it("prefers the provider's clean body when supplied", () => {
    const state = assembleConversationState(
      baseInput({
        rawMessages: [
          rawMsg({
            providerMessageId: "c1",
            rawBody: "RAW with > quoted junk\nOn ... wrote:\n> old",
            providerCleanBody: "Just the new line.",
          }),
        ],
      })
    );
    expect(state.messages[0].cleanBody).toBe("Just the new line.");
  });
});

describe("assembleConversationState — contact resolution", () => {
  it("resolves the customer's verified name/email and excludes the operator's own phone", () => {
    const state = assembleConversationState(
      baseInput({
        rawMessages: [
          rawMsg({
            providerMessageId: "c1",
            fromEmail: "sarah@gmail.com",
            fromName: "Sarah Lee",
            rawBody:
              "Please call me at 778-555-9999. Your office line 250-555-0000 went to voicemail.",
          }),
        ],
      })
    );

    expect(state.contact.email).toBe("sarah@gmail.com");
    expect(state.contact.name).toBe("Sarah Lee");
    expect(state.contact.nameIsVerified).toBe(true);
    // The operator's own line (2505550000) must never be taken as the customer's
    // — the resolver returns the customer's number in its sanitized display form.
    expect(state.contact.phone).toBe("778-555-9999");
  });

  it("prefers the contact-form submitter for identity over the inbound sender", () => {
    const state = assembleConversationState(
      baseInput({
        stage: "qualifying",
        contactFormSubmitter: {
          name: "Bob Vance",
          email: "bob@vancerefrigeration.com",
          phone: "604-555-1212",
        },
        rawMessages: [
          rawMsg({
            providerMessageId: "c1",
            fromEmail: "leads@homeprosite.com",
            fromName: null,
            rawBody: "New website submission",
          }),
        ],
      })
    );
    expect(state.contact.name).toBe("Bob Vance");
    expect(state.contact.email).toBe("bob@vancerefrigeration.com");
    expect(state.contact.nameIsVerified).toBe(true);
  });
});

describe("assembleConversationState — accept signal", () => {
  it("detects a high-confidence accept from explicit language", () => {
    const state = assembleConversationState(
      baseInput({
        rawMessages: [rawMsg({ providerMessageId: "c1", rawBody: "Yes, let's go ahead and book it." })],
      })
    );
    expect(state.accept.detected).toBe(true);
    expect(state.accept.confidence).toBe("high");
    expect(state.accept.evidenceMessageIds).toContain("c1");
  });
});

describe("assembleConversationState — sent ledger", () => {
  it("builds the ledger from operator outbound prices and commitment memories", () => {
    const state = assembleConversationState(
      baseInput({
        rawMessages: [
          rawMsg({ providerMessageId: "c1", fromEmail: "sarah@gmail.com", sentAt: "2026-06-20T10:00:00.000Z", rawBody: "Can you quote a fence?" }),
          rawMsg({
            providerMessageId: "o1",
            fromEmail: "canprojack@gmail.com",
            toEmails: ["sarah@gmail.com"],
            sentAt: "2026-06-20T12:00:00.000Z",
            rawBody: "Your quote is $3,200 for the 40ft cedar fence.",
          }),
        ],
        commitments: [
          { content: "Promised to send the revised quote by Friday", created_at: "2026-06-20T12:05:00.000Z" },
        ],
      })
    );

    expect(state.sentLedger.some((e) => e.amount === 3200)).toBe(true);
    expect(state.sentLedger.some((e) => /revised quote/i.test(e.text))).toBe(true);
  });

  it("never enters a customer's stated budget into the sent ledger", () => {
    const state = assembleConversationState(
      baseInput({
        rawMessages: [
          rawMsg({ providerMessageId: "c1", fromEmail: "sarah@gmail.com", rawBody: "My budget is around $5,000." }),
        ],
      })
    );
    expect(state.sentLedger).toHaveLength(0);
  });
});

describe("assembleConversationState — attachments", () => {
  it("marks an image on a customer inbound as requiring inspection and holds the thread", () => {
    const state = assembleConversationState(
      baseInput({
        rawMessages: [
          rawMsg({
            providerMessageId: "c1",
            rawBody: "",
            attachments: [{ filename: "deck-sketch.jpg", mimeType: "image/jpeg", sizeBytes: 240_000 }],
          }),
        ],
      })
    );

    const m = state.messages[0];
    expect(m.isRealCustomerInbound).toBe(true); // photo-only still counts
    expect(m.attachments[0].kind).toBe("image");
    expect(m.attachments[0].requiresInspection).toBe(true);
    expect(m.attachments[0].inspection).toBeNull();
    expect(state.attachmentsRequiringInspection).toHaveLength(1);
    expect(state.routing).toBe("require_human_review");
  });

  it("does NOT require inspection for an attachment on an operator outbound", () => {
    const state = assembleConversationState(
      baseInput({
        rawMessages: [
          rawMsg({
            providerMessageId: "o1",
            fromEmail: "canprojack@gmail.com",
            toEmails: ["sarah@gmail.com"],
            rawBody: "Quote attached.",
            attachments: [{ filename: "quote.pdf", mimeType: "application/pdf", sizeBytes: 80_000 }],
          }),
        ],
      })
    );
    expect(state.messages[0].attachments[0].kind).toBe("pdf");
    expect(state.messages[0].attachments[0].requiresInspection).toBe(false);
    expect(state.attachmentsRequiringInspection).toHaveLength(0);
  });
});

describe("assembleConversationState — attachment inspection pass-through (Phase 2)", () => {
  it("passes a cached signed-estimate inspection through to the AttachmentRef and raises a HIGH accept", () => {
    const state = assembleConversationState(
      baseInput({
        stage: "quoted", // non-ambiguous stage → no accept-conflict hold
        rawMessages: [
          rawMsg({
            providerMessageId: "c1",
            fromEmail: "sarah@gmail.com",
            fromName: "Sarah Lee",
            rawBody: "", // signed estimate carried as the attachment, body empty
            attachments: [
              {
                filename: "signed-estimate-1042.pdf",
                mimeType: "application/pdf",
                sizeBytes: 120_000,
                inspection: {
                  summary: "Signed estimate #1042, customer signature present, total $8,400",
                  isSignedEstimate: true,
                  facts: { total: 8400, estimateNumber: "1042" },
                  model: "gpt-5.4",
                },
              },
            ],
          }),
        ],
      })
    );

    const att = state.messages[0].attachments[0];
    expect(att.inspection?.isSignedEstimate).toBe(true);
    expect(att.inspection?.summary).toContain("Signed estimate");

    // The deterministic accept-detector fires HIGH off the inspected signed estimate.
    expect(state.accept.detected).toBe(true);
    expect(state.accept.confidence).toBe("high");
    expect(state.accept.basis).toContain("signed_estimate_attachment");
    expect(state.accept.evidenceMessageIds).toContain("c1");

    // A successfully-inspected attachment is RESOLVED — the router must not hold it.
    expect(state.routing).not.toBe("require_human_review");
  });

  it("passes a photo inspection summary through so the drafter can reference it", () => {
    const state = assembleConversationState(
      baseInput({
        rawMessages: [
          rawMsg({
            providerMessageId: "c1",
            rawBody: "Here's the damage.",
            attachments: [
              {
                filename: "fence-damage.jpg",
                mimeType: "image/jpeg",
                sizeBytes: 240_000,
                inspection: {
                  summary: "Photo of storm-damaged cedar fence, ~3 sections leaning",
                  isSignedEstimate: false,
                  facts: {},
                  model: "gpt-5.4",
                },
              },
            ],
          }),
        ],
      })
    );

    const att = state.attachmentsRequiringInspection[0];
    expect(att.inspection?.summary).toContain("storm-damaged");
    expect(att.inspection?.isSignedEstimate).toBe(false);
    // A resolved (non-empty) inspection does not raise an accept signal on its own.
    expect(state.accept.detected).toBe(false);
  });
});

describe("assembleConversationState — meaningfulness gate", () => {
  it("does not count an empty-bodied customer inbound with no attachment as a real customer inbound", () => {
    // A genuinely empty/whitespace body and no attachment carries no customer
    // content — the gate drops it even though the identity-based classifier
    // calls a real sender 'meaningful'.
    const state = assembleConversationState(
      baseInput({ rawMessages: [rawMsg({ providerMessageId: "c1", rawBody: "   \n  " })] })
    );

    expect(state.messages[0].partyRole).toBe("customer");
    expect(state.messages[0].cleanBody.trim()).toBe("");
    expect(state.messages[0].isRealCustomerInbound).toBe(false);
    expect(state.customerMessages).toHaveLength(0);
  });
});

describe("assembleConversationState — routing & shape", () => {
  it("routes to draft when an identified customer is awaiting a reply", () => {
    const state = assembleConversationState(
      baseInput({
        rawMessages: [
          rawMsg({
            providerMessageId: "o1",
            fromEmail: "canprojack@gmail.com",
            toEmails: ["sarah@gmail.com"],
            sentAt: "2026-06-20T10:00:00.000Z",
            rawBody: "Hi Sarah, happy to help.",
          }),
          rawMsg({
            providerMessageId: "c1",
            fromEmail: "sarah@gmail.com",
            fromName: "Sarah Lee",
            sentAt: "2026-06-21T10:00:00.000Z",
            rawBody: "Thanks — can you also quote a gate?",
          }),
        ],
      })
    );
    expect(state.routing).toBe("draft");
  });

  it("returns a fully-populated ConversationState that echoes its ids and stage", () => {
    const state = assembleConversationState(baseInput({ stage: "quoted" }));
    expect(state.threadId).toBe("thread-uuid-1");
    expect(state.connectionId).toBe("conn-1");
    expect(state.companyId).toBe("co-1");
    expect(state.stage).toBe("quoted");
    expect(state.operator).toBe(operator);
    expect(Array.isArray(state.messages)).toBe(true);
    expect(Array.isArray(state.routingReasons)).toBe(true);
    expect(state.routingReasons.length).toBeGreaterThan(0);
    expect(typeof state.confidence).toBe("number");
    expect(state.confidence).toBeGreaterThanOrEqual(0);
    expect(state.confidence).toBeLessThanOrEqual(1);
  });
});
