import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuidedSetupQueryClient } from "../session-service";

const mocks = vi.hoisted(() => ({
  getAccessTokenClient: vi.fn(),
}));

vi.mock("@/lib/supabase/accessToken-client", () => ({
  getAccessTokenClient: mocks.getAccessTokenClient,
}));

import {
  abandonGuidedSetupSession,
  GuidedSetupSessionVersionConflictError,
  loadCompanyCatalogRowSets,
  startOrResumeGuidedSetupSession,
} from "../session-service";

type Row = Record<string, unknown>;
type Filter =
  | { kind: "eq"; column: string; value: string | number }
  | { kind: "in"; column: string; values: readonly string[] };

function createQueryClient(
  seed: Record<string, Row[]>,
  options: { suppressFirstUpdateResponse?: boolean } = {},
) {
  const calls: Array<{ table: string; filters: Filter[] }> = [];
  const updates: Array<{
    table: string;
    filters: Filter[];
    values: Row;
  }> = [];
  let suppressUpdateResponses = options.suppressFirstUpdateResponse ? 1 : 0;

  class Query {
    private filters: Filter[] = [];
    private limitCount: number | null = null;
    private inserted: Row | null = null;
    private updated: Row | null = null;

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq(column: string, value: string | number) {
      this.filters.push({ kind: "eq", column, value });
      return this;
    }

    in(column: string, values: readonly string[]) {
      this.filters.push({ kind: "in", column, values });
      return this;
    }

    order() {
      return this;
    }

    limit(count: number) {
      this.limitCount = count;
      return this;
    }

    insert(values: Row) {
      this.inserted = values;
      return this;
    }

    update(values: Row) {
      this.updated = values;
      return this;
    }

    maybeSingle() {
      return Promise.resolve(this.result(true));
    }

    single() {
      return Promise.resolve(this.result(true));
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(this.result(false)).then(onfulfilled, onrejected);
    }

    private result(single: boolean) {
      calls.push({ table: this.table, filters: [...this.filters] });
      if (this.inserted) {
        const created = {
          id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
          ...this.inserted,
        };
        return { data: single ? created : [created], error: null };
      }

      let rows = [...(seed[this.table] ?? [])];
      for (const filter of this.filters) {
        if (filter.kind === "eq") {
          rows = rows.filter((row) => row[filter.column] === filter.value);
        } else {
          rows = rows.filter(
            (row) =>
              typeof row[filter.column] === "string" &&
              filter.values.includes(row[filter.column] as string),
          );
        }
      }
      if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
      if (this.updated) {
        updates.push({
          table: this.table,
          filters: [...this.filters],
          values: this.updated,
        });
        rows = rows.map((row) => ({ ...row, ...this.updated }));
        seed[this.table] = rows;
        if (suppressUpdateResponses > 0) {
          suppressUpdateResponses -= 1;
          return { data: single ? null : [], error: null };
        }
      }
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
  }

  return {
    calls,
    updates,
    client: {
      from(table: string) {
        return new Query(table);
      },
    } as unknown as GuidedSetupQueryClient,
  };
}

describe("Phase C guided setup session service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads child rows only through company-owned parent IDs", async () => {
    const { client, calls } = createQueryClient({
      products: [
        { id: "product-owned", company_id: "company-1" },
        { id: "product-foreign", company_id: "company-2" },
      ],
      catalog_items: [{ id: "family-owned", company_id: "company-1" }],
      catalog_variants: [{ id: "variant-owned", company_id: "company-1" }],
      product_options: [
        { id: "product-option-owned", product_id: "product-owned" },
        { id: "product-option-foreign", product_id: "product-foreign" },
      ],
      product_option_values: [
        { id: "value-owned", option_id: "product-option-owned" },
        { id: "value-foreign", option_id: "product-option-foreign" },
      ],
      catalog_options: [
        { id: "catalog-option-owned", catalog_item_id: "family-owned" },
        { id: "catalog-option-foreign", catalog_item_id: "family-foreign" },
      ],
      catalog_option_values: [
        { id: "catalog-value-owned", option_id: "catalog-option-owned" },
        { id: "catalog-value-foreign", option_id: "catalog-option-foreign" },
      ],
      catalog_variant_option_values: [
        { id: "join-owned", variant_id: "variant-owned" },
        { id: "join-foreign", variant_id: "variant-foreign" },
      ],
    });

    const rows = await loadCompanyCatalogRowSets(client, "company-1");

    expect(rows.products.map((row) => row.id)).toEqual(["product-owned"]);
    expect(rows.productOptions.map((row) => row.id)).toEqual([
      "product-option-owned",
    ]);
    expect(rows.productOptionValues.map((row) => row.id)).toEqual([
      "value-owned",
    ]);
    expect(rows.catalogOptions.map((row) => row.id)).toEqual([
      "catalog-option-owned",
    ]);
    expect(rows.catalogOptionValues.map((row) => row.id)).toEqual([
      "catalog-value-owned",
    ]);
    expect(rows.variantOptionValues.map((row) => row.id)).toEqual([
      "join-owned",
    ]);
    expect(calls).toContainEqual({
      table: "product_options",
      filters: [
        { kind: "in", column: "product_id", values: ["product-owned"] },
      ],
    });
  });

  it("resumes the company's active session without taking a fresh snapshot", async () => {
    const { client, calls } = createQueryClient({
      catalog_guided_setup_sessions: [
        {
          id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
          company_id: "company-1",
          operator_id: "operator-1",
          mode: "guided",
          status: "review",
          version: 4,
        },
      ],
    });
    mocks.getAccessTokenClient.mockReturnValue(client);

    const result = await startOrResumeGuidedSetupSession({
      token: "token",
      companyId: "company-1",
      operatorId: "operator-2",
    });

    expect(result.resumed).toBe(true);
    expect(result.session.status).toBe("review");
    expect(calls.some((call) => call.table === "products")).toBe(false);
  });

  it("starts with a short conversational question instead of a generated upload gate", async () => {
    const { client } = createQueryClient({});
    mocks.getAccessTokenClient.mockReturnValue(client);

    const result = await startOrResumeGuidedSetupSession({
      token: "token",
      companyId: "company-1",
      operatorId: "operator-2",
    });

    expect(result.resumed).toBe(false);
    expect(result.session).toMatchObject({
      inputRevision: 0,
      processedInputRevision: 0,
      inputLedger: [],
      capabilityManifestRevision:
        "phase-c-capabilities/2026-07-27.1",
    });
    expect(result.session.unresolvedQuestions).toEqual([
      {
        id: "first-service-line",
        intent: "service_selection",
        capabilityRef: "catalog-core/v1",
        prompt: "What service do you want to set up first?",
        answerKind: "text",
        factKeys: ["customer_products.first_service_line"],
        help: "Describe the service, or upload a CSV or Excel price sheet.",
      },
    ]);
    expect(result.session.conversation).toEqual([
      {
        id: "assistant:0:first-service-line",
        role: "assistant",
        kind: "text",
        content: "What service do you want to set up first?",
        version: 0,
      },
    ]);
  });

  it("restores a saved transcript when resuming a guided session", async () => {
    const conversation = [
      {
        id: "assistant:0:first-service-line",
        role: "assistant",
        kind: "text",
        content: "What service do you want to set up first?",
        version: 0,
      },
      {
        id: "operator:1:first-service-line",
        role: "operator",
        kind: "text",
        content: "Vinyl membrane installation",
        version: 1,
      },
      {
        id: "assistant:1:supplier",
        role: "assistant",
        kind: "text",
        content: "Which supplier do you use?",
        version: 1,
      },
    ];
    const { client } = createQueryClient({
      catalog_guided_setup_sessions: [
        {
          id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
          company_id: "company-1",
          operator_id: "operator-1",
          mode: "guided",
          status: "interviewing",
          version: 1,
          facts: [],
          sources: [],
          conversation,
          unresolved_questions: [
            {
              id: "supplier",
              prompt: "Which supplier do you use?",
              answerKind: "text",
              factKeys: ["suppliers.primary"],
            },
          ],
        },
      ],
    });
    mocks.getAccessTokenClient.mockReturnValue(client);

    const result = await startOrResumeGuidedSetupSession({
      token: "token",
      companyId: "company-1",
      operatorId: "operator-2",
    });

    expect(result.session.conversation).toEqual(conversation);
  });

  it("repairs an active session that was stranded on a file question", async () => {
    const { client, updates } = createQueryClient({
      catalog_guided_setup_sessions: [
        {
          id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
          company_id: "company-1",
          operator_id: "operator-1",
          mode: "guided",
          status: "interviewing",
          version: 1,
          facts: [],
          sources: [],
          unresolved_questions: [
            {
              id: "upload-price-sheet",
              prompt: "Upload your current price sheet.",
              answerKind: "file",
              factKeys: ["customer_products"],
            },
          ],
        },
      ],
    });
    mocks.getAccessTokenClient.mockReturnValue(client);

    const result = await startOrResumeGuidedSetupSession({
      token: "token",
      companyId: "company-1",
      operatorId: "operator-2",
    });

    expect(result.resumed).toBe(true);
    expect(result.session.version).toBe(2);
    expect(result.session.unresolvedQuestions).toEqual([
      {
        id: "first-service-line",
        intent: "service_selection",
        capabilityRef: "catalog-core/v1",
        prompt: "What service do you want to set up first?",
        answerKind: "text",
        factKeys: ["customer_products.first_service_line"],
        help: "Describe the service, or upload a CSV or Excel price sheet.",
      },
    ]);
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "catalog_guided_setup_sessions",
        values: expect.objectContaining({
          version: 2,
          unresolved_questions: [
            expect.objectContaining({
              id: "first-service-line",
              answerKind: "text",
            }),
          ],
        }),
        filters: expect.arrayContaining([
          {
            kind: "eq",
            column: "operator_id",
            value: "operator-1",
          },
        ]),
      }),
    );
  });

  it("repairs the invalid review-readiness turn after an unsupported roll inventory request", async () => {
    const inventoryQuestion =
      "How should OPS handle DekSmart membrane purchasing and inventory for vinyl decking?";
    const selectedAnswer =
      "Track membrane as rolls/sheets; purchasing and inventory need roll/sheet dimensions, coverage, and cost details before setup can be ready.";
    const { client, updates } = createQueryClient({
      catalog_guided_setup_sessions: [
        {
          id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
          company_id: "company-1",
          operator_id: "operator-1",
          mode: "guided",
          status: "interviewing",
          version: 12,
          facts: [
            {
              id: "product-name",
              key: "customer_products.vinyl.name",
              value: "68mil Deksmart PVC Membrane",
              classification: "customer_product",
              source: { kind: "operator" },
              confidence: 1,
              status: "confirmed",
              contradicts: [],
            },
            {
              id: "unsupported-roll-inventory",
              key: "materials.vinyl.inventory_policy",
              value: selectedAnswer,
              classification: "inventory_rule",
              source: { kind: "operator" },
              confidence: 1,
              status: "confirmed",
              contradicts: [],
            },
            {
              id: "unsupported-roll-purchasing",
              key: "materials.vinyl.purchasing_quantity_basis",
              value: "roll/sheet",
              classification: "purchasing_rule",
              source: { kind: "operator" },
              confidence: 1,
              status: "confirmed",
              contradicts: [],
            },
          ],
          sources: [],
          conversation: [
            {
              id: "assistant:10:membrane-inventory",
              role: "assistant",
              kind: "text",
              content: inventoryQuestion,
              version: 10,
            },
            {
              id: "operator-input:input-1",
              inputId: "input-1",
              state: "accepted",
              role: "operator",
              kind: "text",
              content: selectedAnswer,
              version: 11,
            },
            {
              id: "assistant:11:membrane-inventory",
              role: "assistant",
              kind: "text",
              content: inventoryQuestion,
              version: 11,
            },
            {
              id: "assistant:12:review-ready",
              role: "assistant",
              kind: "text",
              content: "Is this catalog setup ready for you to review?",
              version: 12,
            },
          ],
          unresolved_questions: [
            {
              id: "review-ready",
              intent: "review_readiness",
              capabilityRef: "catalog-core/v1",
              prompt: "Is this catalog setup ready for you to review?",
              answerKind: "boolean",
              factKeys: ["catalog.review"],
            },
          ],
          proposed_plan: null,
        },
      ],
    });
    mocks.getAccessTokenClient.mockReturnValue(client);

    const result = await startOrResumeGuidedSetupSession({
      token: "token",
      companyId: "company-1",
      operatorId: "operator-2",
    });

    expect(result.resumed).toBe(true);
    expect(result.session.version).toBe(13);
    expect(result.session.unresolvedQuestions).toEqual([
      expect.objectContaining({
        intent: "material_tracking_scope",
        capabilityRef: "static-product-materials/v1",
        answerKind: "single_choice",
        options: [
          "Keep purchasing and inventory staff-managed",
          "Add a fixed material quantity per product unit",
        ],
      }),
    ]);
    expect(result.session.facts).toEqual([
      expect.objectContaining({ id: "product-name" }),
    ]);
    expect(
      result.session.conversation.filter(
        (message: { content?: string }) =>
          message.content === inventoryQuestion,
      ),
    ).toHaveLength(1);
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "catalog_guided_setup_sessions",
        values: expect.objectContaining({
          version: 13,
          facts: [expect.objectContaining({ id: "product-name" })],
          sources: [
            expect.objectContaining({
              kind: "system_repair",
              reason: "unsupported_roll_inventory_review_question",
            }),
          ],
        }),
      }),
    );
  });

  it("resumes the repaired row when another concurrent request wins the repair", async () => {
    const { client } = createQueryClient(
      {
        catalog_guided_setup_sessions: [
          {
            id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
            company_id: "company-1",
            operator_id: "operator-1",
            mode: "guided",
            status: "interviewing",
            version: 1,
            facts: [],
            sources: [],
            unresolved_questions: [
              {
                id: "upload-price-sheet",
                prompt: "Upload your current price sheet.",
                answerKind: "file",
                factKeys: ["customer_products"],
              },
            ],
          },
        ],
      },
      { suppressFirstUpdateResponse: true },
    );
    mocks.getAccessTokenClient.mockReturnValue(client);

    const result = await startOrResumeGuidedSetupSession({
      token: "token",
      companyId: "company-1",
      operatorId: "operator-2",
    });

    expect(result.resumed).toBe(true);
    expect(result.session.version).toBe(2);
    expect(result.session.unresolvedQuestions).toEqual([
      expect.objectContaining({
        id: "first-service-line",
        answerKind: "text",
      }),
    ]);
  });

  it("abandons only the matching active company session and preserves its audit history", async () => {
    const { client, updates } = createQueryClient({
      catalog_guided_setup_sessions: [
        {
          id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
          company_id: "company-1",
          operator_id: "operator-1",
          mode: "guided",
          status: "interviewing",
          version: 2,
          facts: [{ key: "pricing.minimum", value: 1_500 }],
          sources: [{ kind: "operator", questionId: "minimum" }],
        },
      ],
    });
    mocks.getAccessTokenClient.mockReturnValue(client);

    const session = await abandonGuidedSetupSession({
      token: "token",
      companyId: "company-1",
      operatorId: "operator-2",
      sessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
      expectedVersion: 2,
    });

    expect(session.status).toBe("abandoned");
    expect(session.version).toBe(3);
    expect(session.facts).toEqual([
      { key: "pricing.minimum", value: 1_500 },
    ]);
    expect(updates).toContainEqual(
      expect.objectContaining({
        table: "catalog_guided_setup_sessions",
        values: expect.objectContaining({
          status: "abandoned",
          version: 3,
          sources: [
            { kind: "operator", questionId: "minimum" },
            {
              kind: "operator",
              action: "abandon_setup",
              operatorId: "operator-2",
              version: 3,
            },
          ],
        }),
      }),
    );
  });

  it("rejects a stale restart without changing the session", async () => {
    const { client, updates } = createQueryClient({
      catalog_guided_setup_sessions: [
        {
          id: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
          company_id: "company-1",
          status: "interviewing",
          version: 3,
          facts: [],
          sources: [],
        },
      ],
    });
    mocks.getAccessTokenClient.mockReturnValue(client);

    await expect(
      abandonGuidedSetupSession({
        token: "token",
        companyId: "company-1",
        operatorId: "operator-2",
        sessionId: "54ce9e88-5688-4e73-ae4e-a62f85044b77",
        expectedVersion: 2,
      }),
    ).rejects.toBeInstanceOf(GuidedSetupSessionVersionConflictError);
    expect(updates).toEqual([]);
  });
});
