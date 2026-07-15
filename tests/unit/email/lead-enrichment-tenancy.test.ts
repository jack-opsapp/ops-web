import { describe, expect, it } from "vitest";
import {
  applyCanonicalLeadEnrichment,
  type LeadEnrichmentFacts,
} from "@/lib/email/lead-enrichment";

interface OperationCall {
  table: string;
  operation: "select" | "update" | "upsert";
  filters: Array<[column: string, value: string]>;
}

interface QueryResult {
  data?: Record<string, unknown> | null;
  error: null;
}

type FilterableQuery = Promise<QueryResult> & {
  eq: (column: string, value: string) => FilterableQuery;
  maybeSingle: () => Promise<QueryResult>;
  limit: (count: number) => Promise<{ data: never[]; error: null }>;
};

function enrichmentFacts(): LeadEnrichmentFacts {
  return {
    contactName: "Kara Beach",
    companyName: null,
    contactEmail: "kara.beach@example.com",
    contactPhone: "250 555 0100",
    address: "1220 Wharf Street, Victoria BC",
    estimatedValue: 18500,
    description: "New deck build",
    source: "email",
    sourcePlatform: "Wix",
    providerThreadId: "thread-1",
    providerMessageId: "message-1",
    extractionSource: "inbound_sender",
  };
}

function makeSupabaseDouble(input: {
  opportunity: Record<string, unknown> | null;
  client?: Record<string, unknown> | null;
}) {
  const calls: OperationCall[] = [];

  const makeQuery = (
    call: OperationCall,
    row: Record<string, unknown> | null
  ): FilterableQuery => {
    const query: FilterableQuery = Object.assign(
      Promise.resolve({ error: null }),
      {
        eq(column: string, value: string) {
          call.filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => ({ data: row, error: null }),
        limit: async () => ({ data: [], error: null }),
      }
    );
    return query;
  };

  return {
    calls,
    supabase: {
      from(table: string) {
        return {
          select() {
            const call: OperationCall = {
              table,
              operation: "select",
              filters: [],
            };
            calls.push(call);
            const row =
              table === "opportunities"
                ? input.opportunity
                : table === "clients"
                  ? (input.client ?? null)
                  : null;
            return makeQuery(call, row);
          },
          update() {
            const call: OperationCall = {
              table,
              operation: "update",
              filters: [],
            };
            calls.push(call);
            return makeQuery(call, null);
          },
          async upsert() {
            calls.push({ table, operation: "upsert", filters: [] });
            return { error: null };
          },
        };
      },
    },
  };
}

function callsFor(
  calls: OperationCall[],
  table: string,
  operation?: OperationCall["operation"]
): OperationCall[] {
  return calls.filter(
    (call) =>
      call.table === table &&
      (operation === undefined || call.operation === operation)
  );
}

describe("applyCanonicalLeadEnrichment tenant and client authority", () => {
  it("scopes opportunity and client reads and updates to the caller company", async () => {
    const { calls, supabase } = makeSupabaseDouble({
      opportunity: {
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
      client: {
        name: null,
        email: null,
        phone_number: null,
        address: null,
      },
    });

    await applyCanonicalLeadEnrichment({
      supabase,
      opportunityId: "opp-1",
      clientId: "client-1",
      companyId: "company-1",
      facts: enrichmentFacts(),
    });

    expect(callsFor(calls, "opportunities", "select")).toEqual([
      expect.objectContaining({
        filters: [
          ["id", "opp-1"],
          ["company_id", "company-1"],
        ],
      }),
    ]);
    expect(callsFor(calls, "clients", "select")).toEqual([
      expect.objectContaining({
        filters: [
          ["id", "client-1"],
          ["company_id", "company-1"],
        ],
      }),
    ]);
    expect(callsFor(calls, "opportunities", "update")).toEqual([
      expect.objectContaining({
        filters: [
          ["id", "opp-1"],
          ["company_id", "company-1"],
        ],
      }),
    ]);
    expect(callsFor(calls, "clients", "update")).toEqual([
      expect.objectContaining({
        filters: [
          ["id", "client-1"],
          ["company_id", "company-1"],
        ],
      }),
    ]);
  });

  it("fails closed when the opportunity does not exist in the requested company", async () => {
    const { calls, supabase } = makeSupabaseDouble({
      opportunity: null,
      client: {
        name: null,
        email: null,
        phone_number: null,
        address: null,
      },
    });

    await expect(
      applyCanonicalLeadEnrichment({
        supabase,
        opportunityId: "missing-opp",
        clientId: "client-1",
        companyId: "company-1",
        facts: enrichmentFacts(),
      })
    ).rejects.toThrow("Opportunity missing-opp was not found");

    expect(callsFor(calls, "clients")).toHaveLength(0);
    expect(callsFor(calls, "lead_field_provenance")).toHaveLength(0);
    expect(callsFor(calls, "opportunities", "update")).toHaveLength(0);
  });

  it("fails closed when a returned opportunity belongs to a different company", async () => {
    const { calls, supabase } = makeSupabaseDouble({
      opportunity: {
        company_id: "company-2",
        client_id: "client-2",
      },
      client: {
        name: null,
        email: null,
        phone_number: null,
        address: null,
      },
    });

    await expect(
      applyCanonicalLeadEnrichment({
        supabase,
        opportunityId: "opp-2",
        companyId: "company-1",
        facts: enrichmentFacts(),
      })
    ).rejects.toThrow("Opportunity opp-2 does not belong to company company-1");

    expect(callsFor(calls, "clients")).toHaveLength(0);
    expect(callsFor(calls, "lead_field_provenance")).toHaveLength(0);
    expect(callsFor(calls, "opportunities", "update")).toHaveLength(0);
  });

  it("rejects an explicit client that differs from the opportunity client before client or provenance access", async () => {
    const { calls, supabase } = makeSupabaseDouble({
      opportunity: {
        company_id: "company-1",
        client_id: "client-authoritative",
      },
      client: {
        name: null,
        email: null,
        phone_number: null,
        address: null,
      },
    });

    await expect(
      applyCanonicalLeadEnrichment({
        supabase,
        opportunityId: "opp-1",
        clientId: "client-caller",
        companyId: "company-1",
        facts: enrichmentFacts(),
      })
    ).rejects.toThrow(
      "Explicit client client-caller does not match opportunity opp-1 client client-authoritative"
    );

    expect(callsFor(calls, "clients")).toHaveLength(0);
    expect(callsFor(calls, "lead_field_provenance")).toHaveLength(0);
    expect(callsFor(calls, "opportunities", "update")).toHaveLength(0);
  });
});
