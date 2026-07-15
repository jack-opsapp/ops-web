import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "table.footer.label": "Pipeline totals",
        "table.footer.deals": "// {count} deals",
        "table.footer.value": "[VALUE]",
        "table.footer.weighted": "[WEIGHTED]",
      };
      return translations[key] ?? key;
    },
  }),
}));

import { PipelineTableFooter } from "@/app/(dashboard)/pipeline/_components/table/pipeline-table-footer";

describe("PipelineTableFooter", () => {
  it("shows concrete pipeline value without a probability-weighted forecast", () => {
    render(
      <PipelineTableFooter
        total={{ count: 3, sumValue: 10_000, sumWeighted: 2_500 }}
      />
    );

    expect(screen.getByText("[VALUE]")).toBeInTheDocument();
    expect(screen.getByText("$10,000")).toBeInTheDocument();
    expect(screen.queryByText("[WEIGHTED]")).not.toBeInTheDocument();
    expect(screen.queryByText("$2,500")).not.toBeInTheDocument();
  });
});
