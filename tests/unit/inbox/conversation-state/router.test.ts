import { describe, it, expect } from "vitest";
import { route } from "@/lib/api/services/conversation-state/router";
import type {
  ConversationState,
  CleanMessage,
  ResolvedContact,
  OperatorIdentity,
  AcceptSignal,
  AttachmentRef,
} from "@/lib/api/services/conversation-state/types";

// ---------------------------------------------------------------------------
// Fixture builders. The router is a PURE function over already-resolved data,
// so every test assembles a plain RouteInput inline — no DB, no mocks.
// ---------------------------------------------------------------------------

type RouteInput = Omit<ConversationState, "routing" | "routingReasons" | "confidence">;

const operator: OperatorIdentity = {
  emails: new Set(["jack@canpro.example"]),
  domains: new Set(["canpro.example"]),
  phones: new Set(["+15555550100"]),
  addresses: new Set(["100 operator rd"]),
  companyName: "Canpro Fencing",
};

function customerInbound(over: Partial<CleanMessage> = {}): CleanMessage {
  return {
    providerMessageId: "m-cust-1",
    direction: "inbound",
    partyRole: "customer",
    fromEmail: "sarah@gmail.com",
    fromName: "Sarah Lee",
    sentAt: "2026-06-29T12:00:00.000Z",
    cleanBody: "Hi, can you quote a 40ft cedar fence at 12 Oak St?",
    rawBody: "Hi, can you quote a 40ft cedar fence at 12 Oak St?",
    isRealCustomerInbound: true,
    attachments: [],
    ...over,
  };
}

function operatorOutbound(over: Partial<CleanMessage> = {}): CleanMessage {
  return {
    providerMessageId: "m-op-1",
    direction: "outbound",
    partyRole: "operator",
    fromEmail: "jack@canpro.example",
    fromName: "Jack",
    sentAt: "2026-06-29T13:00:00.000Z",
    cleanBody: "Thanks Sarah — quote attached.",
    rawBody: "Thanks Sarah — quote attached.",
    isRealCustomerInbound: false,
    attachments: [],
    ...over,
  };
}

const strongContact: ResolvedContact = {
  name: "Sarah Lee",
  nameIsVerified: true,
  email: "sarah@gmail.com",
  phone: "+15551234567",
  address: "12 Oak St",
  provenance: [],
};

const weakContact: ResolvedContact = {
  name: null,
  nameIsVerified: false,
  email: null,
  phone: null,
  address: null,
  provenance: [],
};

const noAccept: AcceptSignal = {
  detected: false,
  confidence: "low",
  basis: [],
  evidenceMessageIds: [],
};

const requiredUninspectedAttachment: AttachmentRef = {
  filename: "deck-sketch.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 240_000,
  kind: "image",
  requiresInspection: true,
  inspection: null,
};

function build(over: Partial<RouteInput> = {}): RouteInput {
  const messages = over.messages ?? [customerInbound(), operatorOutbound()];
  return {
    threadId: "thread-1",
    connectionId: "conn-1",
    companyId: "co-1",
    operator,
    recipient: { email: "sarah@gmail.com", name: "Sarah Lee" },
    messages,
    customerMessages:
      over.customerMessages ?? messages.filter((m) => m.isRealCustomerInbound),
    contact: strongContact,
    stage: "quoting",
    accept: noAccept,
    sentLedger: [],
    attachmentsRequiringInspection: [],
    ...over,
  };
}

describe("route", () => {
  // -- weak identity ---------------------------------------------------------

  it("requires human review when contact identity is too weak to act", () => {
    const result = route(
      build({
        contact: weakContact,
        recipient: { email: null, name: null },
      }),
    );

    expect(result.routing).toBe("require_human_review");
    expect(
      result.routingReasons.some((r) => /identit/i.test(r)),
    ).toBe(true);
  });

  it("does NOT flag weak identity when at least one of name/email/phone is present", () => {
    // email-only is still actionable identity — must not trip the weak gate.
    const result = route(
      build({
        contact: { ...weakContact, email: "sarah@gmail.com" },
      }),
    );
    expect(
      result.routingReasons.some((r) => /identit/i.test(r)),
    ).toBe(false);
  });

  // -- uninspected required attachment ---------------------------------------

  it("requires human review when a required attachment is uninspected", () => {
    const inbound = customerInbound({
      attachments: [requiredUninspectedAttachment],
    });
    const result = route(
      build({
        messages: [inbound],
        customerMessages: [inbound],
        attachmentsRequiringInspection: [requiredUninspectedAttachment],
      }),
    );

    expect(result.routing).toBe("require_human_review");
    expect(
      result.routingReasons.some((r) => /attachment/i.test(r)),
    ).toBe(true);
  });

  it("requires human review when a required attachment inspection FAILED (summary empty)", () => {
    const failed: AttachmentRef = {
      ...requiredUninspectedAttachment,
      inspection: { summary: "", isSignedEstimate: false, facts: {}, model: "gpt-5.4" },
    };
    const inbound = customerInbound({ attachments: [failed] });
    const result = route(
      build({
        messages: [inbound],
        customerMessages: [inbound],
        attachmentsRequiringInspection: [failed],
      }),
    );
    expect(result.routing).toBe("require_human_review");
    expect(result.routingReasons.some((r) => /attachment/i.test(r))).toBe(true);
  });

  it("does NOT flag an attachment that has a successful inspection", () => {
    const inspected: AttachmentRef = {
      ...requiredUninspectedAttachment,
      inspection: {
        summary: "hand-drawn deck layout ~14ft x 20ft",
        isSignedEstimate: false,
        facts: {},
        model: "gpt-5.4",
      },
    };
    const inbound = customerInbound({ attachments: [inspected] });
    const result = route(
      build({
        messages: [inbound, operatorOutbound()],
        customerMessages: [inbound],
        attachmentsRequiringInspection: [inspected],
      }),
    );
    expect(result.routingReasons.some((r) => /attachment/i.test(r))).toBe(false);
  });

  // -- conflicting accept signals --------------------------------------------

  it("requires human review when a high accept conflicts with active follow-up ambiguity", () => {
    const result = route(
      build({
        stage: "follow_up",
        accept: {
          detected: true,
          confidence: "high",
          basis: ["explicit_accept_language", "verbal_soft"],
          evidenceMessageIds: ["m-cust-1"],
        },
      }),
    );
    expect(result.routing).toBe("require_human_review");
    expect(result.routingReasons.some((r) => /accept|conflict/i.test(r))).toBe(true);
  });

  // -- clean customer inbound awaiting reply ---------------------------------

  it("drafts for a clean customer inbound awaiting a reply with good identity", () => {
    // Last message is a customer inbound (ball in operator's court), strong
    // identity, no unresolved attachments, all messages classified.
    const inbound = customerInbound({ sentAt: "2026-06-29T14:00:00.000Z" });
    const result = route(
      build({
        messages: [operatorOutbound(), inbound],
        customerMessages: [inbound],
      }),
    );

    expect(result.routing).toBe("draft");
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  // -- update_lead_only ------------------------------------------------------

  it("updates lead only when the last message is outbound (ball not in operator's court)", () => {
    // Customer wrote, operator already replied last — no inbound awaiting a reply.
    const result = route(
      build({
        messages: [customerInbound(), operatorOutbound({ sentAt: "2026-06-29T15:00:00.000Z" })],
      }),
    );
    expect(result.routing).toBe("update_lead_only");
  });

  // -- confidence floor ------------------------------------------------------

  it("requires human review when computed confidence falls below 0.5", () => {
    // Strong-ish identity but every message unclassified → low classified share
    // drags confidence under the floor even though no hard gate fires.
    const unknownInbound = customerInbound({
      partyRole: "unknown",
      isRealCustomerInbound: false,
    });
    const result = route(
      build({
        contact: { ...weakContact, phone: "+15551234567" },
        messages: [unknownInbound],
        customerMessages: [],
      }),
    );
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.routing).toBe("require_human_review");
    expect(result.routingReasons.some((r) => /confidence/i.test(r))).toBe(true);
  });

  // -- confidence is a transparent 0..1 blend --------------------------------

  it("returns confidence clamped within [0,1]", () => {
    const result = route(build());
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("scores a fully-classified, complete-contact, no-attachment thread near the top", () => {
    const inbound = customerInbound({ sentAt: "2026-06-29T16:00:00.000Z" });
    const result = route(
      build({
        messages: [operatorOutbound(), inbound],
        customerMessages: [inbound],
      }),
    );
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("always returns at least one human-readable routing reason", () => {
    const result = route(build());
    expect(result.routingReasons.length).toBeGreaterThan(0);
    for (const reason of result.routingReasons) {
      expect(typeof reason).toBe("string");
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });
});
