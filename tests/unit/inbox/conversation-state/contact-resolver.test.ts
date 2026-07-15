import { describe, expect, it } from "vitest";

import {
  persistContactProvenance,
  resolveContact,
} from "@/lib/api/services/conversation-state/contact-resolver";
import type {
  CleanMessage,
  OperatorIdentity,
  ResolvedContact,
} from "@/lib/api/services/conversation-state/types";

// ── Fixtures ────────────────────────────────────────────────────────────────

function operator(overrides: Partial<OperatorIdentity> = {}): OperatorIdentity {
  return {
    emails: new Set(["canprojack@gmail.com", "victoria@canprodeckandrail.com"]),
    domains: new Set(["canprodeckandrail.com"]),
    phones: new Set(["2505550000"]), // Canpro's own line (normalized to digits)
    addresses: new Set(["1200 industrial way, victoria, bc"]),
    companyName: "Canpro Deck and Rail",
    ...overrides,
  };
}

function customerInbound(overrides: Partial<CleanMessage> = {}): CleanMessage {
  return {
    providerMessageId: "msg-customer-1",
    direction: "inbound",
    partyRole: "customer",
    fromEmail: "jane.doe@hotmail.com",
    fromName: "Jane Doe",
    sentAt: "2026-06-20T15:00:00.000Z",
    cleanBody: "Hi, I'd like a quote for a cedar fence.",
    rawBody: "Hi, I'd like a quote for a cedar fence.",
    isRealCustomerInbound: true,
    attachments: [],
    ...overrides,
  };
}

// ── (4) name provenance ─────────────────────────────────────────────────────

describe("resolveContact — name verification", () => {
  it("sets nameIsVerified=true from a real display name", () => {
    const result = resolveContact({
      messages: [customerInbound({ fromName: "Jane Doe" })],
      operator: operator(),
    });
    expect(result.name).toBe("Jane Doe");
    expect(result.nameIsVerified).toBe(true);
    expect(
      result.provenance.some(
        (p) => p.field === "name" && p.source === "from_header"
      )
    ).toBe(true);
  });

  it("sets nameIsVerified=true from a contact-form Name field", () => {
    const result = resolveContact({
      messages: [customerInbound({ fromName: null })],
      operator: operator(),
      contactFormSubmitter: {
        name: "Bob Vance",
        email: "bob@vancerefrigeration.com",
      },
    });
    expect(result.name).toBe("Bob Vance");
    expect(result.nameIsVerified).toBe(true);
    expect(
      result.provenance.some(
        (p) => p.field === "name" && p.source === "contact_form"
      )
    ).toBe(true);
  });

  it("never sets the email local-part as a verified name (bare gmail sender)", () => {
    const result = resolveContact({
      messages: [
        customerInbound({
          fromEmail: "canprojack2@gmail.com",
          fromName: null,
          providerMessageId: "msg-bare",
        }),
      ],
      // operator does NOT include canprojack2 — it's a real (if anonymous) customer
      operator: operator(),
    });
    // a display value may be derived, but it must NOT be marked verified
    expect(result.nameIsVerified).toBe(false);
    // and if a fallback display is offered it is the local-part-derived guess, never "verified"
    if (result.name !== null) {
      expect(result.name.toLowerCase()).not.toBe("jane doe");
    }
  });

  it("rejects a provider-synthesized fromName that is just the email local-part", () => {
    const result = resolveContact({
      messages: [
        customerInbound({
          fromEmail: "chezbear02@gmail.com",
          fromName: "chezbear02",
          providerMessageId: "msg-synthetic-name",
        }),
      ],
      operator: operator(),
    });

    expect(result.nameIsVerified).toBe(false);
  });

  it("rejects a generic fromName as a verified name", () => {
    const result = resolveContact({
      messages: [customerInbound({ fromName: "New Lead" })],
      operator: operator(),
    });
    expect(result.nameIsVerified).toBe(false);
  });
});

// ── (1) operator-exclusion on email ─────────────────────────────────────────

describe("resolveContact — operator exclusion (email)", () => {
  it("repairs the exact gmail.con typo before returning a customer email", () => {
    const result = resolveContact({
      messages: [
        customerInbound({
          fromEmail: "sarah.lee@gmail.con",
          fromName: "Sarah Lee",
        }),
      ],
      operator: operator(),
    });

    expect(result.email).toBe("sarah.lee@gmail.com");
  });

  it("never returns an operator email as the customer email", () => {
    const result = resolveContact({
      messages: [
        // forwarded lead: outer sender is the operator's own mailbox
        customerInbound({
          fromEmail: "victoria@canprodeckandrail.com",
          fromName: "Victoria",
          providerMessageId: "msg-fwd-outer",
        }),
      ],
      operator: operator(),
    });
    expect(result.email).not.toBe("victoria@canprodeckandrail.com");
  });

  it("returns the real customer email from a customer-role message", () => {
    const result = resolveContact({
      messages: [customerInbound({ fromEmail: "jane.doe@hotmail.com" })],
      operator: operator(),
    });
    expect(result.email).toBe("jane.doe@hotmail.com");
    expect(result.provenance.some((p) => p.field === "email")).toBe(true);
  });
});

// ── (1)+(2)+(3) phone: operator exclusion + shape + bounding ─────────────────

describe("resolveContact — phone resolution", () => {
  it("yields the CUSTOMER phone, never the operator signature phone", () => {
    // Customer gave their number in the body; the operator's signature phone
    // also appears (forwarded thread). The operator's must be excluded.
    const result = resolveContact({
      messages: [
        customerInbound({
          cleanBody:
            "Hi, please call me at 604-555-9988 about the fence.\n\nPhone: 250-555-0000",
          rawBody:
            "Hi, please call me at 604-555-9988 about the fence.\n\nPhone: 250-555-0000",
        }),
      ],
      operator: operator({ phones: new Set(["2505550000"]) }),
    });
    expect(result.phone).not.toBeNull();
    // operator phone digits must never be returned
    expect((result.phone ?? "").replace(/\D/g, "")).not.toBe("2505550000");
    expect((result.phone ?? "").replace(/\D/g, "")).toBe("6045559988");
  });

  it("returns null (not the operator phone) when only the operator phone is present", () => {
    const result = resolveContact({
      messages: [
        customerInbound({
          cleanBody: "Thanks!\n\nPhone: 250-555-0000",
          rawBody: "Thanks!\n\nPhone: 250-555-0000",
        }),
      ],
      operator: operator({ phones: new Set(["2505550000"]) }),
    });
    expect(result.phone).toBeNull();
  });

  it("does not treat a stray order number as a phone", () => {
    const result = resolveContact({
      messages: [
        customerInbound({
          cleanBody: "Following up on Order #20260520 — any update?",
          rawBody: "Following up on Order #20260520 — any update?",
        }),
      ],
      operator: operator(),
    });
    expect(result.phone).toBeNull();
  });

  it("does not treat a date-like run as a phone", () => {
    const result = resolveContact({
      messages: [
        customerInbound({
          cleanBody: "Can you start the week of 2026 05 20?",
          rawBody: "Can you start the week of 2026 05 20?",
        }),
      ],
      operator: operator(),
    });
    expect(result.phone).toBeNull();
  });

  it("takes the contact-form phone field when provided and valid", () => {
    const result = resolveContact({
      messages: [customerInbound()],
      operator: operator(),
      contactFormSubmitter: {
        name: "Jane Doe",
        email: "jane.doe@hotmail.com",
        phone: "(778) 555-1234",
      },
    });
    expect((result.phone ?? "").replace(/\D/g, "")).toBe("7785551234");
    expect(
      result.provenance.some(
        (p) => p.field === "phone" && p.source === "contact_form"
      )
    ).toBe(true);
  });
});

// ── (1)+(3) address: operator exclusion + bounded collection ─────────────────

describe("resolveContact — address resolution", () => {
  it("collects a bounded customer address from a contact-form block, stopping at the next label", () => {
    const result = resolveContact({
      messages: [
        customerInbound({
          cleanBody: [
            "Name: Jane Doe",
            "Address: 42 Wallaby Way",
            "Sydney, BC",
            "",
            "Message: I want a new deck. Please call my office.",
            "Sales | Canpro Deck and Rail | 1200 Industrial Way, Victoria, BC",
          ].join("\n"),
          rawBody: "",
        }),
      ],
      operator: operator(),
    });
    expect(result.address).not.toBeNull();
    const addr = (result.address ?? "").toLowerCase();
    // bounded: stops at the blank line / next label — never runs into the message or signature
    expect(addr).toContain("42 wallaby way");
    expect(addr).not.toContain("i want a new deck");
    expect(addr).not.toContain("1200 industrial way");
  });

  it("excludes the operator's own address", () => {
    const result = resolveContact({
      messages: [
        customerInbound({
          cleanBody: [
            "Address: 1200 Industrial Way, Victoria, BC",
            "",
            "Thanks",
          ].join("\n"),
          rawBody: "",
        }),
      ],
      operator: operator({
        addresses: new Set(["1200 industrial way, victoria, bc"]),
      }),
    });
    expect(result.address).toBeNull();
  });

  it("takes the contact-form address field when provided", () => {
    const result = resolveContact({
      messages: [customerInbound()],
      operator: operator(),
      contactFormSubmitter: {
        name: "Jane Doe",
        email: "jane.doe@hotmail.com",
        address: "42 Wallaby Way, Sydney BC",
      },
    });
    expect((result.address ?? "").toLowerCase()).toContain("42 wallaby way");
    expect(
      result.provenance.some(
        (p) => p.field === "address" && p.source === "contact_form"
      )
    ).toBe(true);
  });
});

// ── empty / no-signal ───────────────────────────────────────────────────────

describe("resolveContact — empty state", () => {
  it("returns nulls (never throws) when no customer signal exists", () => {
    const result = resolveContact({
      messages: [
        {
          providerMessageId: "op-1",
          direction: "outbound",
          partyRole: "operator",
          fromEmail: "canprojack@gmail.com",
          fromName: "Jack",
          sentAt: "2026-06-20T15:00:00.000Z",
          cleanBody: "Following up.",
          rawBody: "Following up.",
          isRealCustomerInbound: false,
          attachments: [],
        },
      ],
      operator: operator(),
    });
    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.address).toBeNull();
    expect(result.nameIsVerified).toBe(false);
    expect(Array.isArray(result.provenance)).toBe(true);
  });
});

// ── persistContactProvenance — payload shape against the real schema ─────────
//
// The latent `lead_field_provenance` table keys provenance by
// (entity_type, entity_id) with field_name / value_snapshot / provider_message_id
// columns. These tests pin the insert payload to that schema so a future column
// rename is caught here rather than at a runtime insert error.

function fakeProvenanceClient(error: unknown = null) {
  const captured: Record<string, unknown>[][] = [];
  const options: { onConflict: string }[] = [];
  const client = {
    from(_table: string) {
      return {
        upsert(
          rows: Record<string, unknown>[],
          upsertOptions: { onConflict: string }
        ) {
          captured.push(rows);
          options.push(upsertOptions);
          return Promise.resolve({ error });
        },
      };
    },
  };
  return { client, captured, options };
}

describe("persistContactProvenance", () => {
  it("writes rows matching the lead_field_provenance schema", async () => {
    const { client, captured, options } = fakeProvenanceClient();
    const contact: ResolvedContact = {
      name: "Sarah Lee",
      nameIsVerified: true,
      email: "sarah@gmail.com",
      phone: "778-555-9999",
      address: "12 Oak St",
      provenance: [
        {
          field: "name",
          source: "from_header",
          confidence: 0.85,
          providerThreadId: null,
          sourceMessageId: "m1",
        },
        {
          field: "phone",
          source: "message_body",
          confidence: 0.6,
          providerThreadId: null,
          sourceMessageId: "m1",
        },
      ],
    };

    const res = await persistContactProvenance({
      supabase: client,
      companyId: "co-1",
      entityType: "opportunity",
      entityId: "opp-1",
      contact,
      providerThreadId: "thread-1",
    });

    expect(res.error).toBeNull();
    expect(captured).toHaveLength(1);
    expect(options).toEqual([
      { onConflict: "company_id,entity_type,entity_id,field_name" },
    ]);
    const rows = captured[0];
    expect(rows).toHaveLength(2);

    const nameRow = rows.find((r) => r.field_name === "contact_name")!;
    expect(nameRow).toMatchObject({
      company_id: "co-1",
      entity_type: "opportunity",
      entity_id: "opp-1",
      field_name: "contact_name",
      value_snapshot: "Sarah Lee",
      source: "inbound",
      confidence: 0.85,
      provider_thread_id: "thread-1",
      provider_message_id: "m1",
    });

    const phoneRow = rows.find((r) => r.field_name === "contact_phone")!;
    expect(phoneRow.value_snapshot).toBe("778-555-9999");
    expect(phoneRow.source).toBe("inbound");

    // Must NOT use the previous (wrong) column names.
    expect(nameRow).not.toHaveProperty("opportunity_id");
    expect(nameRow).not.toHaveProperty("field");
    expect(nameRow).not.toHaveProperty("source_message_id");
  });

  it("no-ops on empty provenance", async () => {
    const { client, captured } = fakeProvenanceClient();
    const contact: ResolvedContact = {
      name: null,
      nameIsVerified: false,
      email: null,
      phone: null,
      address: null,
      provenance: [],
    };
    const res = await persistContactProvenance({
      supabase: client,
      companyId: "co-1",
      entityType: "client",
      entityId: "client-1",
      contact,
      providerThreadId: null,
    });
    expect(res.error).toBeNull();
    expect(captured).toHaveLength(0);
  });

  it("does not persist an unverified email-local-part display name", async () => {
    const { client, captured } = fakeProvenanceClient();
    const contact: ResolvedContact = {
      name: "Chezbear02",
      nameIsVerified: false,
      email: "chezbear02@gmail.com",
      phone: null,
      address: null,
      provenance: [
        {
          field: "name",
          source: "email_local_part_unverified",
          confidence: 0.2,
          providerThreadId: null,
          sourceMessageId: "m1",
        },
      ],
    };

    const result = await persistContactProvenance({
      supabase: client,
      companyId: "co-1",
      entityType: "opportunity",
      entityId: "opp-1",
      contact,
      providerThreadId: "thread-1",
    });

    expect(result.error).toBeNull();
    expect(captured).toHaveLength(0);
  });

  it("throws a database upsert error instead of reporting success", async () => {
    const databaseError = { code: "23514", message: "check constraint failed" };
    const { client } = fakeProvenanceClient(databaseError);
    const contact: ResolvedContact = {
      name: "Sarah Lee",
      nameIsVerified: true,
      email: null,
      phone: null,
      address: null,
      provenance: [
        {
          field: "name",
          source: "contact_form",
          confidence: 0.95,
          providerThreadId: null,
          sourceMessageId: "m1",
        },
      ],
    };

    await expect(
      persistContactProvenance({
        supabase: client,
        companyId: "co-1",
        entityType: "opportunity",
        entityId: "opp-1",
        contact,
        providerThreadId: "thread-1",
      })
    ).rejects.toMatchObject({ cause: databaseError });
  });
});
