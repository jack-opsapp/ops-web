import { describe, expect, it } from "vitest";
import {
  applyCanonicalLeadEnrichment,
  buildLeadEnrichmentUpdates,
  provenanceConfidenceForFacts,
  provenanceConfidenceForSource,
  provenanceSourceForFacts,
} from "@/lib/email/lead-enrichment";
import type { LeadEnrichmentFacts } from "@/lib/email/lead-enrichment";

interface UpsertCall {
  rows: Record<string, unknown>[];
  options: { onConflict: string };
}

/**
 * Minimal Supabase double. Returns the supplied opportunity/client rows for
 * select(...).eq(...).maybeSingle(), swallows update(...).eq(...), and captures
 * lead_field_provenance upsert(...) calls.
 */
function fakeSupabase(opts: {
  opportunityRow: Record<string, unknown> | null;
  clientRow?: Record<string, unknown> | null;
  upserts: UpsertCall[];
}) {
  return {
    from(table: string) {
      if (table === "lead_field_provenance") {
        return {
          upsert: async (
            rows: Record<string, unknown>[],
            options: { onConflict: string }
          ) => {
            opts.upserts.push({ rows, options });
            return { error: null };
          },
        };
      }
      const row =
        table === "opportunities" ? opts.opportunityRow : opts.clientRow ?? null;
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
        update: () => ({
          eq: async () => ({ error: null }),
        }),
      };
    },
  };
}

function inboundFacts(
  overrides: Partial<LeadEnrichmentFacts> = {}
): LeadEnrichmentFacts {
  return {
    contactName: "Kara Beach",
    companyName: null,
    contactEmail: "kara.beach@example.com",
    contactPhone: "250 538 8340",
    address: "1220 Wharf Street, Victoria BC V8W 1T8",
    estimatedValue: 18500,
    description: "New deck build",
    source: "email",
    sourcePlatform: "Wix",
    providerThreadId: "thread-1",
    providerMessageId: "message-1",
    extractionSource: "inbound_sender",
    ...overrides,
  };
}

describe("provenance source + confidence mapping", () => {
  it("maps extractionSource to provenance source", () => {
    expect(
      provenanceSourceForFacts({ extractionSource: "inbound_sender" })
    ).toBe("inbound");
    expect(
      provenanceSourceForFacts({ extractionSource: "outbound_recipient" })
    ).toBe("outbound");
    expect(
      provenanceSourceForFacts({ extractionSource: "contact_form" })
    ).toBe("contact_form");
    expect(
      provenanceSourceForFacts({ extractionSource: "import_payload" })
    ).toBe("import");
  });

  it("maps ai_classified to source='ai'", () => {
    expect(
      provenanceSourceForFacts({ extractionSource: "ai_classified" })
    ).toBe("ai");
  });

  it("resolves to operator when an actor is present", () => {
    expect(
      provenanceSourceForFacts(
        { extractionSource: "inbound_sender" },
        "user-1"
      )
    ).toBe("operator");
  });

  it("assigns confidence per the documented convention", () => {
    expect(provenanceConfidenceForSource("operator")).toBe(1.0);
    expect(provenanceConfidenceForSource("contact_form")).toBe(1.0);
    expect(provenanceConfidenceForSource("import")).toBe(0.8);
    expect(provenanceConfidenceForSource("inbound")).toBe(0.6);
    expect(provenanceConfidenceForSource("outbound")).toBe(0.5);
    expect(provenanceConfidenceForSource("ai")).toBeNull();
  });

  it("uses the model confidence for ai-classified facts (clamped 0..1)", () => {
    expect(
      provenanceConfidenceForFacts(
        { extractionSource: "ai_classified", aiConfidence: 0.83 },
        "ai"
      )
    ).toBe(0.83);
    // Clamp out-of-range model values.
    expect(
      provenanceConfidenceForFacts(
        { extractionSource: "ai_classified", aiConfidence: 1.4 },
        "ai"
      )
    ).toBe(1);
    // Missing confidence falls back to null.
    expect(
      provenanceConfidenceForFacts(
        { extractionSource: "ai_classified", aiConfidence: null },
        "ai"
      )
    ).toBeNull();
    // Non-ai sources ignore aiConfidence and use the per-source convention.
    expect(
      provenanceConfidenceForFacts(
        { extractionSource: "inbound_sender", aiConfidence: 0.2 },
        "inbound"
      )
    ).toBe(0.6);
  });
});

describe("source_message_id / source_metadata fill-blank", () => {
  it("writes both when the opportunity is blank", () => {
    const updates = buildLeadEnrichmentUpdates({
      existingOpportunity: {
        contact_name: null,
        address: null,
        source_email_id: null,
        source_message_id: null,
        source_metadata: null,
      },
      facts: inboundFacts(),
    });
    expect(updates.opportunity.source_message_id).toBe("message-1");
    expect(updates.opportunity.source_metadata).toEqual({
      platform_name: "Wix",
      detected_via: "inbound_sender",
      provider_thread_id: "thread-1",
    });
  });

  it("never overwrites an existing source_message_id or source_metadata", () => {
    const updates = buildLeadEnrichmentUpdates({
      existingOpportunity: {
        contact_name: "Kara Beach",
        address: "10 Operator Road",
        source_email_id: "existing-thread",
        source_message_id: "existing-message",
        source_metadata: { platform_name: "HomeStars" },
      },
      facts: inboundFacts(),
    });
    expect(updates.opportunity.source_message_id).toBeUndefined();
    expect(updates.opportunity.source_metadata).toBeUndefined();
  });
});

describe("applyCanonicalLeadEnrichment provenance writes", () => {
  it("upserts one provenance row per filled field with the right source", async () => {
    const upserts: UpsertCall[] = [];
    const supabase = fakeSupabase({
      opportunityRow: {
        client_id: "client-1",
        contact_name: null,
        contact_email: null,
        contact_phone: null,
        address: null,
        estimated_value: null,
        detected_value: null,
        description: null,
        source: null,
        source_email_id: null,
        source_message_id: null,
        source_metadata: null,
      },
      clientRow: {
        name: "kara.beach@example.com",
        email: null,
        phone_number: null,
        address: null,
      },
      upserts,
    });

    await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: "opp-1",
      clientId: "client-1",
      facts: inboundFacts(),
      companyId: "company-1",
    });

    expect(upserts).toHaveLength(1);
    expect(upserts[0].options.onConflict).toBe(
      "company_id,entity_type,entity_id,field_name"
    );
    const rows = upserts[0].rows;

    // Every row carries the inbound source + 0.6 confidence + provider ids.
    for (const row of rows) {
      expect(row.source).toBe("inbound");
      expect(row.confidence).toBe(0.6);
      expect(row.provider_message_id).toBe("message-1");
      expect(row.provider_thread_id).toBe("thread-1");
      expect(row.company_id).toBe("company-1");
      expect(row.actor_user_id).toBeNull();
    }

    const oppFields = rows
      .filter((r) => r.entity_type === "opportunity")
      .map((r) => r.field_name)
      .sort();
    expect(oppFields).toEqual(
      [
        "address",
        "contact_email",
        "contact_name",
        "contact_phone",
        "description",
        "detected_value",
        "estimated_value",
      ].sort()
    );

    const addressRow = rows.find(
      (r) => r.entity_type === "opportunity" && r.field_name === "address"
    );
    expect(addressRow?.value_snapshot).toBe(
      "1220 Wharf Street, Victoria BC V8W 1T8"
    );

    // Client rows present for the fields the client update filled.
    const clientFields = rows
      .filter((r) => r.entity_type === "client")
      .map((r) => r.field_name)
      .sort();
    expect(clientFields).toEqual(["address", "email", "name", "phone_number"]);
  });

  it("writes source='operator' with actor and confidence 1.0 on operator edits", async () => {
    const upserts: UpsertCall[] = [];
    const supabase = fakeSupabase({
      opportunityRow: {
        client_id: null,
        contact_name: null,
        address: null,
        estimated_value: null,
        detected_value: null,
        description: null,
        source: null,
        source_email_id: null,
        source_message_id: null,
        source_metadata: null,
      },
      upserts,
    });

    await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: "opp-1",
      facts: inboundFacts({ address: "55 Operator Lane" }),
      companyId: "company-1",
      actorUserId: "user-1",
    });

    const rows = upserts[0].rows;
    for (const row of rows) {
      expect(row.source).toBe("operator");
      expect(row.confidence).toBe(1.0);
      expect(row.actor_user_id).toBe("user-1");
    }
  });

  it("does NOT write provenance for fields the fill-blank gate discarded", async () => {
    const upserts: UpsertCall[] = [];
    const supabase = fakeSupabase({
      opportunityRow: {
        client_id: null,
        contact_name: "Operator Name",
        contact_email: "operator.set@example.com",
        contact_phone: "555-000-1111",
        address: "10 Operator Road",
        estimated_value: 42000,
        detected_value: 41000,
        description: "Operator scope",
        source: "referral",
        source_email_id: "existing-thread",
        source_message_id: "existing-message",
        source_metadata: { platform_name: "HomeStars" },
      },
      upserts,
    });

    await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: "opp-1",
      facts: inboundFacts(),
      companyId: "company-1",
    });

    // Nothing was filled, so no provenance rows are upserted.
    expect(upserts).toHaveLength(0);
  });

  it("writes source='ai' with the model confidence on AI-classified facts", async () => {
    const upserts: UpsertCall[] = [];
    const supabase = fakeSupabase({
      opportunityRow: {
        client_id: null,
        contact_name: null,
        address: null,
        estimated_value: null,
        detected_value: null,
        description: null,
        source: null,
        source_email_id: null,
        source_message_id: null,
        source_metadata: null,
      },
      upserts,
    });

    await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: "opp-1",
      facts: inboundFacts({
        extractionSource: "ai_classified",
        aiConfidence: 0.91,
      }),
      companyId: "company-1",
    });

    const rows = upserts[0].rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.source).toBe("ai");
      expect(row.confidence).toBe(0.91);
    }
  });

  it("degrades gracefully when the provenance table is missing (no throw)", async () => {
    const supabase = {
      from(table: string) {
        if (table === "lead_field_provenance") {
          return {
            upsert: async () => {
              throw new Error('relation "lead_field_provenance" does not exist');
            },
          };
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  client_id: null,
                  contact_name: null,
                  address: null,
                  estimated_value: null,
                  detected_value: null,
                  description: null,
                  source: null,
                  source_email_id: null,
                  source_message_id: null,
                  source_metadata: null,
                },
                error: null,
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    };

    // Must resolve, not reject, even though the provenance upsert throws.
    await expect(
      applyCanonicalLeadEnrichment({
        supabase,
        opportunityId: "opp-1",
        facts: inboundFacts(),
        companyId: "company-1",
      })
    ).resolves.toBeDefined();
  });

  it("skips provenance entirely when companyId is absent", async () => {
    const upserts: UpsertCall[] = [];
    const supabase = fakeSupabase({
      opportunityRow: {
        client_id: null,
        contact_name: null,
        address: null,
        estimated_value: null,
        detected_value: null,
        description: null,
        source: null,
        source_email_id: null,
        source_message_id: null,
        source_metadata: null,
      },
      upserts,
    });

    await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: "opp-1",
      facts: inboundFacts(),
    });

    expect(upserts).toHaveLength(0);
  });
});
