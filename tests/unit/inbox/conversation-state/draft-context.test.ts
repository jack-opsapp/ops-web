import { describe, it, expect } from "vitest";

import { buildDraftStateContext } from "@/lib/api/services/conversation-state/draft-context";
import type {
  ConversationState,
  CleanMessage,
  SentLedgerEntry,
  AttachmentRef,
  OperatorIdentity,
  ResolvedContact,
  AcceptSignal,
} from "@/lib/api/services/conversation-state/types";

// ─────────────────────────────────────────────────────────────────────────────
// draft-context — PURE. Turns a ConversationState into the Phase-1 drafting
// fragments: recipient/greeting (the ACTUAL last sender), clean thread text,
// the "already sent — do not restate" ledger block, and attachment awareness.
// ─────────────────────────────────────────────────────────────────────────────

const operator: OperatorIdentity = {
  emails: new Set(["jack@canpro.example"]),
  domains: new Set(["canpro.example"]),
  phones: new Set<string>(),
  addresses: new Set<string>(),
  companyName: "Canpro",
};

const contact: ResolvedContact = {
  name: "Sarah Lee",
  nameIsVerified: true,
  email: "sarah@gmail.com",
  phone: null,
  address: null,
  provenance: [],
};

const noAccept: AcceptSignal = { detected: false, confidence: "low", basis: [], evidenceMessageIds: [] };

function msg(over: Partial<CleanMessage> = {}): CleanMessage {
  return {
    providerMessageId: "m1",
    direction: "inbound",
    partyRole: "customer",
    fromEmail: "sarah@gmail.com",
    fromName: "Sarah Lee",
    sentAt: "2026-06-29T12:00:00.000Z",
    cleanBody: "Can you also do a gate?",
    rawBody: "Can you also do a gate?",
    isRealCustomerInbound: true,
    attachments: [],
    ...over,
  };
}

function state(over: Partial<ConversationState> = {}): ConversationState {
  const messages = over.messages ?? [msg()];
  return {
    threadId: "thread-1",
    connectionId: "conn-1",
    companyId: "co-1",
    operator,
    recipient: { email: "sarah@gmail.com", name: "Sarah Lee" },
    messages,
    customerMessages: over.customerMessages ?? messages.filter((m) => m.isRealCustomerInbound),
    contact,
    stage: "quoting",
    accept: noAccept,
    sentLedger: [],
    attachmentsRequiringInspection: [],
    routing: "draft",
    routingReasons: [],
    confidence: 0.9,
    ...over,
  };
}

describe("buildDraftStateContext — recipient / greeting", () => {
  it("binds the greeting to the actual latest inbound sender (not the linked client)", () => {
    const ctx = buildDraftStateContext(state());
    expect(ctx.recipientName).toBe("Sarah Lee");
    expect(ctx.recipientEmail).toBe("sarah@gmail.com");
    expect(ctx.greetingFirstName).toBe("Sarah");
  });

  it("yields a null first name when the recipient name is unknown", () => {
    const ctx = buildDraftStateContext(state({ recipient: { email: "x@y.com", name: null } }));
    expect(ctx.greetingFirstName).toBeNull();
    expect(ctx.recipientEmail).toBe("x@y.com");
  });
});

describe("buildDraftStateContext — sent ledger (no restate)", () => {
  it("emits a do-not-restate block listing already-sent prices", () => {
    const sentLedger: SentLedgerEntry[] = [
      { kind: "quote", text: "Quoted $3,200 for 40ft cedar fence", amount: 3200, sentAt: "2026-06-20T00:00:00.000Z", sourceMessageId: "o1" },
    ];
    const ctx = buildDraftStateContext(state({ sentLedger }));
    expect(ctx.sentLedgerBlock).not.toBe("");
    expect(ctx.sentLedgerBlock.toLowerCase()).toMatch(/do not restate|already (sent|provided)/);
    expect(ctx.sentLedgerBlock).toContain("Quoted $3,200 for 40ft cedar fence");
  });

  it("returns an empty ledger block when nothing has been sent", () => {
    const ctx = buildDraftStateContext(state({ sentLedger: [] }));
    expect(ctx.sentLedgerBlock).toBe("");
  });
});

describe("buildDraftStateContext — attachment awareness", () => {
  it("tells the drafter attachments were sent and to acknowledge them naturally", () => {
    const att: AttachmentRef = {
      filename: "deck-sketch.jpg", mimeType: "image/jpeg", sizeBytes: 1000, kind: "image", requiresInspection: true, inspection: null,
    };
    const ctx = buildDraftStateContext(state({ attachmentsRequiringInspection: [att] }));
    expect(ctx.attachmentBlock).not.toBe("");
    expect(ctx.attachmentBlock.toLowerCase()).toMatch(/acknowledge/);
    expect(ctx.attachmentBlock.toLowerCase()).toMatch(/do not describe|no play-by-play/);
  });

  it("returns an empty attachment block when there are none", () => {
    const ctx = buildDraftStateContext(state({ attachmentsRequiringInspection: [] }));
    expect(ctx.attachmentBlock).toBe("");
  });

  it("does NOT recite the vision summary or filename into the customer-facing draft", () => {
    const att: AttachmentRef = {
      filename: "fence-damage.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 240_000,
      kind: "image",
      requiresInspection: true,
      inspection: {
        summary: "Photo of storm-damaged cedar fence, ~3 sections leaning",
        isSignedEstimate: false,
        facts: { sections: 3 },
        model: "gpt-5.4",
      },
    };
    const ctx = buildDraftStateContext(state({ attachmentsRequiringInspection: [att] }));
    // The vision verdict is INTERNAL — it must never leak into the draft as
    // robotic content narration.
    expect(ctx.attachmentBlock).not.toContain("storm-damaged cedar fence");
    expect(ctx.attachmentBlock).not.toContain("fence-damage.jpg");
    // …but the drafter is still told the attachment exists and to acknowledge it.
    expect(ctx.attachmentBlock.toLowerCase()).toMatch(/acknowledge/);
  });

  it("flags a signed estimate by TYPE (for tone) without reciting its parsed contents", () => {
    const att: AttachmentRef = {
      filename: "estimate-1042-signed.pdf",
      mimeType: "application/pdf",
      sizeBytes: 88_000,
      kind: "pdf",
      requiresInspection: true,
      inspection: {
        summary: "signed estimate #1042, total $8,400",
        isSignedEstimate: true,
        facts: { total: 8400, estimateNumber: "1042" },
        model: "gpt-5.4",
      },
    };
    const ctx = buildDraftStateContext(state({ attachmentsRequiringInspection: [att] }));
    expect(ctx.attachmentBlock.toLowerCase()).toContain("signed estimate");
    // Still no recitation of the parsed figures or filename.
    expect(ctx.attachmentBlock).not.toContain("8,400");
    expect(ctx.attachmentBlock).not.toContain("estimate-1042-signed.pdf");
  });
});

describe("buildDraftStateContext — clean thread text", () => {
  it("renders the thread from clean bodies with YOU/THEM markers, newest customer text surfaced", () => {
    const outbound = msg({
      providerMessageId: "o1", direction: "outbound", partyRole: "operator",
      fromEmail: "jack@canpro.example", fromName: "Jack", isRealCustomerInbound: false,
      sentAt: "2026-06-29T10:00:00.000Z", cleanBody: "Here is your quote.",
      rawBody: "Here is your quote.\n\nOn ... wrote:\n> old quoted junk",
    });
    const inbound = msg({
      providerMessageId: "c1", sentAt: "2026-06-29T11:00:00.000Z",
      cleanBody: "Thanks — can you also do a gate?",
      rawBody: "Thanks — can you also do a gate?\n\nOn ... Jack wrote:\n> Here is your quote.",
    });
    const ctx = buildDraftStateContext(state({ messages: [outbound, inbound], customerMessages: [inbound] }));

    expect(ctx.cleanThread).toContain("[YOU]");
    expect(ctx.cleanThread).toContain("[THEM]");
    expect(ctx.cleanThread).toContain("Here is your quote.");
    expect(ctx.cleanThread).toContain("Thanks — can you also do a gate?");
    // clean bodies only — no quoted chain leaks in
    expect(ctx.cleanThread).not.toMatch(/old quoted junk|On \.\.\. wrote/);
    // latest customer text is the most recent real customer inbound
    expect(ctx.latestCustomerText).toBe("Thanks — can you also do a gate?");
  });
});
