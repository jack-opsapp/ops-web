import { describe, expect, it } from "vitest";
import { formatMetricValue } from "@/components/metrics/format";
import { intervalToDays } from "@/lib/api/services/metrics-service";

describe("pipeline metrics formatting", () => {
  it("parses Postgres interval strings into day counts", () => {
    expect(intervalToDays("2 days 12:00:00")).toBe(2.5);
    expect(intervalToDays("48:00:00")).toBe(2);
    expect(intervalToDays(86_400_000)).toBe(1);
  });

  it("uses the OPS empty metric marker for non-finite values", () => {
    expect(formatMetricValue(Number.NaN, "days")).toBe("—");
    expect(formatMetricValue(Number.POSITIVE_INFINITY, "currency")).toBe("—");
  });
});
