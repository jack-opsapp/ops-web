import { describe, expect, it } from "vitest";

import {
  GetOperationalOverviewInputSchema,
  GetOperationalOverviewResultSchema,
  OPERATIONAL_OVERVIEW_COMPONENTS,
  OPERATIONAL_OVERVIEW_FETCH_LIMIT,
  OPERATIONAL_OVERVIEW_MAX_ATTENTION_COUNT,
  OPERATIONAL_OVERVIEW_MAX_SOURCE_ROWS,
  OPERATIONAL_OVERVIEW_PROMPT_SAFETY_DIRECTIVE,
  assertNoOperationalOverviewForbiddenFields,
  normalizeOperationalOverviewSelections,
} from "../operational-overview";

const READ_AT = "2026-08-29T23:00:00.000Z";
const REVISIONS = [
  { domain: "integrations", source_revision: 7 },
  { domain: "schedule", source_revision: 11 },
] as const;

function validResult() {
  const items = [
    {
      component: "integration_attention" as const,
      state: "clear" as const,
      attention_count: 0,
      count_state: "exact" as const,
    },
    {
      component: "schedule_readiness" as const,
      state: "attention" as const,
      attention_count: 25,
      count_state: "at_least_limit" as const,
    },
  ];
  return {
    items,
    item_proofs: items.map((_, index) => ({
      proof_ref: `ops_proof:v1:${String(index + 1).repeat(32)}`,
      read_at: READ_AT,
      source_revisions: [REVISIONS[index]!],
    })),
    evidence: items.map((_, index) => ({
      evidence_ref: `ops_evidence:v1:${String(index + 3).repeat(32)}`,
      source_domain: "overview",
      source_type: "operational_overview_component",
      occurred_at: READ_AT,
    })),
    warnings: [
      {
        code: "DEFAULT_COMPONENT_OMITTED" as const,
        component: "financial_attention" as const,
      },
    ],
    collection_proof: {
      proof_ref: `ops_proof:v1:${"9".repeat(32)}`,
      read_at: READ_AT,
      source_revisions: REVISIONS,
      returned_count: items.length,
      has_more: false,
    },
  };
}

function warningsOnlyResult() {
  return {
    items: [],
    item_proofs: [],
    evidence: [],
    warnings: OPERATIONAL_OVERVIEW_COMPONENTS.map((component) => ({
      code: "DEFAULT_COMPONENT_OMITTED" as const,
      component,
    })),
    collection_proof: {
      proof_ref: `ops_proof:v1:${"A".repeat(32)}`,
      read_at: READ_AT,
      source_revisions: [],
      returned_count: 0,
      has_more: false,
    },
  };
}

describe("operational overview contract", () => {
  it("normalizes omission to all six canonical default selections", () => {
    expect(GetOperationalOverviewInputSchema.parse({})).toEqual({});
    expect(normalizeOperationalOverviewSelections({})).toEqual(
      OPERATIONAL_OVERVIEW_COMPONENTS.map((component) => ({
        component,
        origin: "default",
      }))
    );
  });

  it("canonicalizes a nonempty explicit subset without filling defaults", () => {
    expect(
      GetOperationalOverviewInputSchema.parse({
        components: ["work_due", "financial_attention"],
      })
    ).toEqual({
      components: ["financial_attention", "work_due"],
    });
    expect(
      normalizeOperationalOverviewSelections({
        components: ["work_due", "financial_attention"],
      })
    ).toEqual([
      { component: "financial_attention", origin: "explicit" },
      { component: "work_due", origin: "explicit" },
    ]);
  });

  it("rejects empty, duplicate, unknown, and overbroad selectors", () => {
    for (const value of [
      { components: [] },
      { components: ["work_due", "work_due"] },
      { components: ["customers"] },
      { components: [...OPERATIONAL_OVERVIEW_COMPONENTS, "work_due"] },
      { components: ["work_due"], include_rows: true },
      null,
    ]) {
      expect(() => GetOperationalOverviewInputSchema.parse(value)).toThrow();
    }
  });

  it("freezes the 25/26/501 physical bounds and prompt boundary", () => {
    expect(OPERATIONAL_OVERVIEW_MAX_ATTENTION_COUNT).toBe(25);
    expect(OPERATIONAL_OVERVIEW_FETCH_LIMIT).toBe(26);
    expect(OPERATIONAL_OVERVIEW_MAX_SOURCE_ROWS).toBe(501);
    expect(OPERATIONAL_OVERVIEW_PROMPT_SAFETY_DIRECTIVE).toContain(
      "closed server-derived"
    );
  });

  it("accepts only the closed count and state coupling", () => {
    expect(GetOperationalOverviewResultSchema.parse(validResult())).toEqual(
      validResult()
    );

    for (const mutate of [
      (value: ReturnType<typeof validResult>) => {
        value.items[0]!.state = "attention";
      },
      (value: ReturnType<typeof validResult>) => {
        value.items[0]!.attention_count = 1;
      },
      (value: ReturnType<typeof validResult>) => {
        value.items[1]!.attention_count = 24;
      },
      (value: ReturnType<typeof validResult>) => {
        value.items[1]!.attention_count = 26;
      },
    ]) {
      const value = structuredClone(validResult());
      mutate(value);
      expect(() => GetOperationalOverviewResultSchema.parse(value)).toThrow();
    }

    const exactAttention = structuredClone(validResult());
    exactAttention.items[1]!.count_state = "exact";
    expect(GetOperationalOverviewResultSchema.parse(exactAttention)).toEqual(
      exactAttention
    );

    const belowLimitAttention = structuredClone(validResult());
    belowLimitAttention.items[1]!.attention_count = 24;
    belowLimitAttention.items[1]!.count_state = "exact";
    expect(
      GetOperationalOverviewResultSchema.parse(belowLimitAttention)
    ).toEqual(belowLimitAttention);
  });

  it("accepts a real warnings-only proof with no fabricated revisions", () => {
    expect(
      GetOperationalOverviewResultSchema.parse(warningsOnlyResult())
    ).toEqual(warningsOnlyResult());
  });

  it("rejects noncanonical, duplicate, leaking, or uncoupled results", () => {
    for (const mutate of [
      (value: ReturnType<typeof validResult>) => {
        value.items.reverse();
      },
      (value: ReturnType<typeof validResult>) => {
        (value.items[1] as unknown as { component: string }).component =
          "integration_attention";
      },
      (value: ReturnType<typeof validResult>) => {
        (
          value.warnings as unknown as Array<{
            code: "DEFAULT_COMPONENT_OMITTED";
            component: string;
          }>
        ).push({
          code: "DEFAULT_COMPONENT_OMITTED",
          component: "integration_attention",
        });
      },
      (value: ReturnType<typeof validResult>) => {
        value.item_proofs.pop();
      },
      (value: ReturnType<typeof validResult>) => {
        value.evidence[0]!.occurred_at = "2026-08-29T23:00:01.000Z";
      },
      (value: ReturnType<typeof validResult>) => {
        value.item_proofs[0]!.source_revisions = [];
      },
      (value: ReturnType<typeof validResult>) => {
        (
          value.collection_proof as unknown as {
            source_revisions: unknown[];
          }
        ).source_revisions = [REVISIONS[0]!];
      },
      (value: ReturnType<typeof validResult>) => {
        (
          value.item_proofs[1] as unknown as {
            source_revisions: unknown[];
          }
        ).source_revisions = [{ domain: "integrations", source_revision: 999 }];
      },
      (value: ReturnType<typeof validResult>) => {
        (
          value.collection_proof as unknown as {
            source_revisions: unknown[];
          }
        ).source_revisions = [...REVISIONS].reverse();
      },
      (value: ReturnType<typeof validResult>) => {
        value.collection_proof.returned_count = 1;
      },
      (value: ReturnType<typeof validResult>) => {
        value.collection_proof.has_more = true;
      },
      (value: ReturnType<typeof validResult>) => {
        (value.items[0] as unknown as Record<string, unknown>).job_ref = {
          kind: "job",
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        };
      },
    ]) {
      const value = structuredClone(validResult());
      mutate(value);
      expect(() => GetOperationalOverviewResultSchema.parse(value)).toThrow();
    }
  });

  it("rejects drilldown, money, provider, and source-count fields recursively", () => {
    expect(() =>
      assertNoOperationalOverviewForbiddenFields({
        safe: { component: "work_due", attention_count: 1 },
      })
    ).not.toThrow();
    for (const field of [
      "job_ref",
      "task_ref",
      "subject",
      "amount",
      "currency",
      "provider",
      "reason_code",
      "source_inspected",
      "source_counts",
      "cards",
    ]) {
      expect(() =>
        assertNoOperationalOverviewForbiddenFields({ [field]: "hidden" })
      ).toThrowError("OPERATIONAL_OVERVIEW_FORBIDDEN_FIELD");
    }
  });
});
