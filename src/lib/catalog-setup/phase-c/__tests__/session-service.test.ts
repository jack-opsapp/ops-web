import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuidedSetupQueryClient } from "../session-service";

const mocks = vi.hoisted(() => ({
  getAccessTokenClient: vi.fn(),
}));

vi.mock("@/lib/supabase/accessToken-client", () => ({
  getAccessTokenClient: mocks.getAccessTokenClient,
}));

import {
  loadCompanyCatalogRowSets,
  startOrResumeGuidedSetupSession,
} from "../session-service";

type Row = Record<string, unknown>;
type Filter =
  | { kind: "eq"; column: string; value: string }
  | { kind: "in"; column: string; values: readonly string[] };

function createQueryClient(seed: Record<string, Row[]>) {
  const calls: Array<{ table: string; filters: Filter[] }> = [];

  class Query {
    private filters: Filter[] = [];
    private limitCount: number | null = null;
    private inserted: Row | null = null;

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    eq(column: string, value: string) {
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
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
  }

  return {
    calls,
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
});
