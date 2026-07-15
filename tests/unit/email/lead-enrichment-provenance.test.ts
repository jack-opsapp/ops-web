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

interface FilterableSingleQuery {
  eq: (column: string, value: string) => FilterableSingleQuery;
  maybeSingle: () => Promise<{
    data: Record<string, unknown> | null;
    error: unknown | null;
  }>;
}

type FilterableUpdateQuery = Promise<{ error: unknown | null }> & {
  eq: (column: string, value: string) => FilterableUpdateQuery;
};

function filterableSingleResult(
  data: Record<string, unknown> | null,
  error: unknown | null = null
): FilterableSingleQuery {
  const query: FilterableSingleQuery = {
    eq: () => query,
    maybeSingle: async () => ({ data, error }),
  };
  return query;
}

function filterableUpdateResult(
  error: unknown | null = null
): FilterableUpdateQuery {
  const query: FilterableUpdateQuery = Object.assign(
    Promise.resolve({ error }),
    {
      eq: () => query,
    }
  );
  return query;
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
  provenanceRows?: Record<string, unknown>[];
}) {
  return {
    from(table: string) {
      if (table === "lead_field_provenance") {
        const provenanceQuery = {
          eq: () => provenanceQuery,
          limit: async () => ({
            data: opts.provenanceRows ?? [],
            error: null,
          }),
        };
        return {
          select: () => provenanceQuery,
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
        table === "opportunities"
          ? opts.opportunityRow
          : (opts.clientRow ?? null);
      return {
        select: () => filterableSingleResult(row),
        update: () => filterableUpdateResult(),
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
    expect(provenanceSourceForFacts({ extractionSource: "contact_form" })).toBe(
      "contact_form"
    );
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
      provenanceSourceForFacts({ extractionSource: "inbound_sender" }, "user-1")
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
  it("derives company scope from the opportunity when the caller omits it", async () => {
    const upserts: UpsertCall[] = [];
    const supabase = fakeSupabase({
      opportunityRow: {
        company_id: "company-from-opportunity",
        client_id: null,
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
      upserts,
    });

    await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: "opp-1",
      facts: inboundFacts(),
    });

    expect(upserts).toHaveLength(1);
    expect(upserts[0].rows).not.toHaveLength(0);
    expect(
      upserts[0].rows.every(
        (row) => row.company_id === "company-from-opportunity"
      )
    ).toBe(true);
  });

  it("does not replace an operator-confirmed local-part-derived name recorded with the legacy field key", async () => {
    const upserts: UpsertCall[] = [];
    const supabase = fakeSupabase({
      opportunityRow: {
        company_id: "company-1",
        client_id: null,
        contact_name: "Sarah Lee",
        contact_email: "sarah.lee@gmail.com",
        contact_phone: "250-555-0101",
        address: "10 Operator Road",
        estimated_value: 42000,
        detected_value: 42000,
        description: "Operator scope",
        source: "referral",
        source_email_id: "existing-thread",
        source_message_id: "existing-message",
        source_metadata: { platform_name: "Wix" },
      },
      provenanceRows: [
        {
          entity_type: "opportunity",
          entity_id: "opp-1",
          field_name: "name",
          source: "operator",
          confirmed_at: "2026-07-01T00:00:00.000Z",
          confirmed_by: "user-1",
        },
      ],
      upserts,
    });

    const updates = await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: "opp-1",
      facts: inboundFacts({
        contactName: "Sarah Anne Lee",
        contactEmail: "sarah.lee@gmail.com",
        contactPhone: null,
        address: null,
        estimatedValue: null,
        description: null,
        sourcePlatform: null,
      }),
      companyId: "company-1",
    });

    expect(updates.opportunity.contact_name).toBeUndefined();
    expect(upserts).toHaveLength(0);
  });

  it("protects every operator-confirmed contact field even when its stored value looks weak", async () => {
    const upserts: UpsertCall[] = [];
    const protectedRows = [
      ["opportunity", "opp-1", "email"],
      ["opportunity", "opp-1", "phone_number"],
      ["opportunity", "opp-1", "address"],
      ["client", "client-1", "email"],
      ["client", "client-1", "phone_number"],
      ["client", "client-1", "address"],
    ].map(([entity_type, entity_id, field_name]) => ({
      entity_type,
      entity_id,
      field_name,
      source: "operator",
      confirmed_at: "2026-07-01T00:00:00.000Z",
      confirmed_by: "user-1",
    }));
    const supabase = fakeSupabase({
      opportunityRow: {
        company_id: "company-1",
        client_id: "client-1",
        contact_name: "Kara Beach",
        contact_email: null,
        contact_phone: null,
        address: null,
        estimated_value: 42000,
        detected_value: 42000,
        description: "Operator scope",
        source: "referral",
        source_email_id: "existing-thread",
        source_message_id: "existing-message",
        source_metadata: { platform_name: "Wix" },
      },
      clientRow: {
        name: "Kara Beach",
        email: null,
        phone_number: null,
        address: null,
      },
      provenanceRows: protectedRows,
      upserts,
    });

    const updates = await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: "opp-1",
      clientId: "client-1",
      companyId: "company-1",
      facts: inboundFacts({
        contactName: null,
        estimatedValue: null,
        description: null,
        sourcePlatform: null,
      }),
    });

    expect(updates.opportunity).not.toHaveProperty("contact_email");
    expect(updates.opportunity).not.toHaveProperty("contact_phone");
    expect(updates.opportunity).not.toHaveProperty("address");
    expect(updates.client).not.toHaveProperty("email");
    expect(updates.client).not.toHaveProperty("phone_number");
    expect(updates.client).not.toHaveProperty("address");
    expect(upserts).toHaveLength(0);
  });

  it("protects an actor-authored field when legacy source metadata is incomplete", async () => {
    const supabase = fakeSupabase({
      opportunityRow: {
        company_id: "company-1",
        client_id: null,
        contact_name: "Operator Choice",
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
      provenanceRows: [
        {
          entity_type: "opportunity",
          entity_id: "opp-1",
          field_name: "name",
          source: "inbound",
          actor_user_id: "user-1",
          confirmed_at: null,
          confirmed_by: null,
        },
      ],
      upserts: [],
    });

    const updates = await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: "opp-1",
      companyId: "company-1",
      facts: inboundFacts({ contactName: "Model Replacement" }),
    });

    expect(updates.opportunity).not.toHaveProperty("contact_name");
  });

  it("surfaces an opportunity update error before reporting enrichment success", async () => {
    const databaseError = { code: "42501", message: "permission denied" };
    const supabase = {
      from() {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  client_id: null,
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
                error: null,
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: databaseError }) }),
        };
      },
    };

    await expect(
      applyCanonicalLeadEnrichment({
        supabase,
        opportunityId: "opp-1",
        facts: inboundFacts(),
      })
    ).rejects.toMatchObject({ cause: databaseError });
  });

  it("surfaces an opportunity read error instead of treating it as an empty row", async () => {
    const databaseError = { code: "08006", message: "connection failure" };
    const supabase = {
      from() {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: databaseError }),
            }),
          }),
        };
      },
    };

    await expect(
      applyCanonicalLeadEnrichment({
        supabase,
        opportunityId: "opp-1",
        facts: inboundFacts(),
      })
    ).rejects.toMatchObject({ cause: databaseError });
  });

  it("upserts one provenance row per filled field with the right source", async () => {
    const upserts: UpsertCall[] = [];
    const supabase = fakeSupabase({
      opportunityRow: {
        company_id: "company-1",
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
        "contact_address",
        "contact_email",
        "contact_name",
        "contact_phone",
        "description",
        "detected_value",
        "estimated_value",
      ].sort()
    );

    const addressRow = rows.find(
      (r) =>
        r.entity_type === "opportunity" && r.field_name === "contact_address"
    );
    expect(addressRow?.value_snapshot).toBe(
      "1220 Wharf Street, Victoria BC V8W 1T8"
    );

    // Client rows present for the fields the client update filled.
    const clientFields = rows
      .filter((r) => r.entity_type === "client")
      .map((r) => r.field_name)
      .sort();
    expect(clientFields).toEqual([
      "contact_address",
      "contact_email",
      "contact_name",
      "contact_phone",
    ]);
  });

  it("writes source='operator' with actor and confidence 1.0 on operator edits", async () => {
    const upserts: UpsertCall[] = [];
    const supabase = fakeSupabase({
      opportunityRow: {
        company_id: "company-1",
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
        company_id: "company-1",
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

  it("promotes strictly better evidence only when provenance still matches the current value", async () => {
    const upserts: UpsertCall[] = [];
    const provenanceRows = [
      ["opportunity", "opp-1", "contact_email", "mariahbur@gmail.con"],
      ["opportunity", "opp-1", "contact_phone", "250-555-0101"],
      ["opportunity", "opp-1", "contact_address", "10 Old Road"],
      ["client", "client-1", "contact_email", "mariahbur@gmail.con"],
      ["client", "client-1", "contact_phone", "250-555-0101"],
      ["client", "client-1", "contact_address", "10 Old Road"],
    ].map(([entity_type, entity_id, field_name, value_snapshot]) => ({
      entity_type,
      entity_id,
      field_name,
      value_snapshot,
      source: "inbound",
      confidence: 0.6,
      actor_user_id: null,
      confirmed_at: null,
      confirmed_by: null,
    }));
    const supabase = fakeSupabase({
      opportunityRow: {
        company_id: "company-1",
        client_id: "client-1",
        contact_name: "Mariah Burr",
        contact_email: "mariahbur@gmail.con",
        contact_phone: "250-555-0101",
        address: "10 Old Road",
        estimated_value: 42000,
        detected_value: 42000,
        description: "Operator-entered scope stays unchanged",
        source: "email",
        source_email_id: "existing-thread",
        source_message_id: "existing-message",
        source_metadata: null,
      },
      clientRow: {
        name: "Mariah Burr",
        email: "mariahbur@gmail.con",
        phone_number: "250-555-0101",
        address: "10 Old Road",
      },
      provenanceRows,
      upserts,
    });

    const updates = await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: "opp-1",
      clientId: "client-1",
      companyId: "company-1",
      facts: inboundFacts({
        contactName: "Mariah Burr",
        contactEmail: "mariahbur@gmail.com",
        contactPhone: "250-555-0199",
        address: "20 Correct Road",
        estimatedValue: null,
        description: "Lower-priority new scope",
        sourcePlatform: null,
        extractionSource: "contact_form",
      }),
    });

    expect(updates.opportunity).toMatchObject({
      contact_email: "mariahbur@gmail.com",
      contact_phone: "250-555-0199",
      address: "20 Correct Road",
    });
    expect(updates.opportunity.description).toBeUndefined();
    expect(updates.client).toMatchObject({
      email: "mariahbur@gmail.com",
      phone_number: "250-555-0199",
      address: "20 Correct Road",
    });
    expect(upserts[0].rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: "opportunity",
          field_name: "contact_phone",
          value_snapshot: "250-555-0199",
          source: "contact_form",
          confidence: 1,
        }),
      ])
    );
  });

  it("writes source='ai' with the model confidence on AI-classified facts", async () => {
    const upserts: UpsertCall[] = [];
    const supabase = fakeSupabase({
      opportunityRow: {
        company_id: "company-1",
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

  it("surfaces a thrown provenance database failure", async () => {
    const supabase = {
      from(table: string) {
        if (table === "lead_field_provenance") {
          const provenanceQuery = {
            eq: () => provenanceQuery,
            limit: async () => ({ data: [], error: null }),
          };
          return {
            select: () => provenanceQuery,
            upsert: async () => {
              throw new Error(
                'relation "lead_field_provenance" does not exist'
              );
            },
          };
        }
        const opportunityRow = {
          company_id: "company-1",
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
        };
        return {
          select: () => filterableSingleResult(opportunityRow),
          update: () => filterableUpdateResult(),
        };
      },
    };

    await expect(
      applyCanonicalLeadEnrichment({
        supabase,
        opportunityId: "opp-1",
        facts: inboundFacts(),
        companyId: "company-1",
      })
    ).rejects.toThrow('relation "lead_field_provenance" does not exist');
  });

  it("surfaces an error returned by the provenance upsert", async () => {
    const databaseError = {
      code: "23514",
      message: "lead_field_provenance_source_check failed",
    };
    const supabase = {
      from(table: string) {
        if (table === "lead_field_provenance") {
          const provenanceQuery = {
            eq: () => provenanceQuery,
            limit: async () => ({ data: [], error: null }),
          };
          return {
            select: () => provenanceQuery,
            upsert: async () => ({ error: databaseError }),
          };
        }
        const opportunityRow = {
          company_id: "company-1",
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
        };
        return {
          select: () => filterableSingleResult(opportunityRow),
          update: () => filterableUpdateResult(),
        };
      },
    };

    await expect(
      applyCanonicalLeadEnrichment({
        supabase,
        opportunityId: "opp-1",
        facts: inboundFacts(),
        companyId: "company-1",
      })
    ).rejects.toMatchObject({ cause: databaseError });
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
