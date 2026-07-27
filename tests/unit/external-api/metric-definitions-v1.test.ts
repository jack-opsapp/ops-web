import { describe, expect, it } from "vitest";

import { metricIdSchema } from "@/lib/external-api/contracts/metrics";
import {
  financialMetricIdsV1,
  metricDefinitionsV1,
} from "@/lib/external-api/analytics/metric-definitions/v1";

describe("external metric definitions v1", () => {
  it("defines every public metric exactly once and immutably", () => {
    const expected = new Set(metricIdSchema.options);
    const actual = new Set(metricDefinitionsV1.map((item) => item.id));
    expect(actual).toEqual(expected);
    expect(metricDefinitionsV1).toHaveLength(expected.size);
    expect(metricDefinitionsV1.every((item) => item.version === "1")).toBe(
      true
    );
  });

  it("marks only the five additive-scope financial metrics", () => {
    expect([...financialMetricIdsV1]).toEqual([
      "cohort_open_estimated_value",
      "cohort_won_value",
      "cohort_average_won_value",
      "invoiced_event_total",
      "paid_event_total",
    ]);
    expect(
      metricDefinitionsV1
        .filter((item) => item.financial)
        .every(
          (item) => item.unit === "currency" && item.suppressBelowCohort === 5
        )
    ).toBe(true);
  });
});
