// tests/unit/inbox/conversation-state/sent-ledger.test.ts
//
// Pure-core tests for the "already sent" ledger. The drafter consumes
// SentLedgerEntry[] so it never re-quotes a price the operator already sent
// (fixes "draft repeated a price already sent"). No DB, no network, no mocks —
// the pure core takes already-fetched plain data.

import { describe, it, expect } from "vitest";
import { buildSentLedger } from "@/lib/api/services/conversation-state/sent-ledger";
import type { CleanMessage } from "@/lib/api/services/conversation-state/types";

// ── Fixture helpers ─────────────────────────────────────────────────────────

function outbound(overrides: Partial<CleanMessage> = {}): CleanMessage {
  return {
    providerMessageId: "msg-out-1",
    direction: "outbound",
    partyRole: "operator",
    fromEmail: "owner@maverick.example",
    fromName: "Owner",
    sentAt: "2026-06-20T15:00:00.000Z",
    cleanBody: "",
    rawBody: "",
    isRealCustomerInbound: false,
    attachments: [],
    ...overrides,
  };
}

function inbound(overrides: Partial<CleanMessage> = {}): CleanMessage {
  return {
    providerMessageId: "msg-in-1",
    direction: "inbound",
    partyRole: "customer",
    fromEmail: "john@acme.example",
    fromName: "John",
    sentAt: "2026-06-19T12:00:00.000Z",
    cleanBody: "",
    rawBody: "",
    isRealCustomerInbound: true,
    attachments: [],
    ...overrides,
  };
}

describe("buildSentLedger — commitment memories", () => {
  it("maps a quoted-price commitment to an entry carrying the parsed amount", () => {
    const ledger = buildSentLedger({
      commitments: [
        {
          content: "Quoted $3,200 for 40ft cedar fence",
          created_at: "2026-06-20T15:30:00.000Z",
        },
      ],
      outboundMessages: [],
    });

    expect(ledger).toHaveLength(1);
    const [entry] = ledger;
    expect(entry.amount).toBe(3200);
    expect(entry.text).toBe("Quoted $3,200 for 40ft cedar fence");
    // "Quoted ... $" content reads as a quote.
    expect(entry.kind).toBe("quote");
    expect(entry.sentAt).toBe("2026-06-20T15:30:00.000Z");
  });

  it("infers kind='promise' from promise/commitment language without a price", () => {
    const ledger = buildSentLedger({
      commitments: [
        {
          content: "Owner promised revised quote to John by Friday",
          due_date: "2026-06-26T17:00:00.000Z",
          created_at: "2026-06-20T15:30:00.000Z",
        },
      ],
      outboundMessages: [],
    });

    expect(ledger).toHaveLength(1);
    expect(ledger[0].kind).toBe("promise");
    expect(ledger[0].amount == null).toBe(true);
  });

  it("falls back to kind='commitment' for neutral commitment content with no price or promise language", () => {
    const ledger = buildSentLedger({
      commitments: [
        // No price, no quote/estimate word, no promise/future-action phrasing —
        // a recorded standing fact that is still a commitment.
        { content: "Standard warranty covers labor for one year", created_at: "2026-06-20T15:30:00.000Z" },
      ],
      outboundMessages: [],
    });

    expect(ledger).toHaveLength(1);
    expect(ledger[0].kind).toBe("commitment");
  });
});

describe("buildSentLedger — outbound price detection", () => {
  it("extracts a stated total from operator outbound cleanBody as a price entry", () => {
    const ledger = buildSentLedger({
      commitments: [],
      outboundMessages: [
        outbound({
          providerMessageId: "msg-out-42",
          sentAt: "2026-06-21T09:00:00.000Z",
          cleanBody: "Thanks for the details — the total comes to $4,500. Let me know how you'd like to proceed.",
        }),
      ],
    });

    expect(ledger).toHaveLength(1);
    const [entry] = ledger;
    expect(entry.kind).toBe("price");
    expect(entry.amount).toBe(4500);
    expect(entry.sourceMessageId).toBe("msg-out-42");
    expect(entry.sentAt).toBe("2026-06-21T09:00:00.000Z");
  });

  it("parses a 'N dollars' phrasing as a price amount", () => {
    const ledger = buildSentLedger({
      commitments: [],
      outboundMessages: [
        outbound({
          providerMessageId: "msg-out-7",
          cleanBody: "We can do the whole job for 3200 dollars including materials.",
        }),
      ],
    });

    expect(ledger).toHaveLength(1);
    expect(ledger[0].kind).toBe("price");
    expect(ledger[0].amount).toBe(3200);
    expect(ledger[0].sourceMessageId).toBe("msg-out-7");
  });

  it("returns [] when there are no prices and no commitments", () => {
    const ledger = buildSentLedger({
      commitments: [],
      outboundMessages: [
        outbound({ cleanBody: "Sounds good, I'll swing by next week to take a look." }),
      ],
    });

    expect(ledger).toEqual([]);
  });

  it("ignores inbound customer messages — only operator outbound prices count", () => {
    const ledger = buildSentLedger({
      commitments: [],
      outboundMessages: [
        // A customer's stated budget must NOT enter the operator's sent-ledger.
        inbound({ cleanBody: "My budget is around $5,000 if that helps." }),
      ],
    });

    expect(ledger).toEqual([]);
  });
});

describe("buildSentLedger — dedupe", () => {
  it("dedupes a commitment-quoted price against the same price restated in an outbound", () => {
    const ledger = buildSentLedger({
      commitments: [
        {
          content: "Quoted $3,200 for 40ft cedar fence",
          created_at: "2026-06-20T15:30:00.000Z",
        },
      ],
      outboundMessages: [
        outbound({
          providerMessageId: "msg-out-99",
          cleanBody: "As mentioned, the price is $3,200 for the cedar fence.",
        }),
      ],
    });

    // Both name $3,200 — collapse to a single ledger entry.
    const amounts = ledger.map((e) => e.amount);
    expect(amounts.filter((a) => a === 3200)).toHaveLength(1);
  });

  it("keeps distinct amounts as separate entries", () => {
    const ledger = buildSentLedger({
      commitments: [],
      outboundMessages: [
        outbound({ providerMessageId: "a", cleanBody: "Base package is $1,200." }),
        outbound({ providerMessageId: "b", cleanBody: "Premium package is $2,400." }),
      ],
    });

    const amounts = ledger.map((e) => e.amount).sort((x, y) => (x ?? 0) - (y ?? 0));
    expect(amounts).toEqual([1200, 2400]);
  });
});
