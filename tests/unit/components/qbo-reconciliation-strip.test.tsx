import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

import { ReconciliationStrip } from "@/components/accounting/qbo/reconciliation-strip";
import type { QboReconciliation } from "@/lib/types/qbo-import";

// Read-only model: QB is authoritative, so OPS mirrors QB on apply. A/R is the
// only row that carries an independent QB-vs-OPS pair; collected + customer
// counts mirror QB by construction (always matched).
const matchedRecon: QboReconciliation = {
  qbOpenAr: 12000,
  opsToBeOpenAr: 12000,
  openInvoiceCount: 9,
  collectedInWindow: 80000,
  customerCount: 10,
  arMatched: true,
};

describe("ReconciliationStrip", () => {
  it("marks a to-the-cent A/R match as success", () => {
    render(<ReconciliationStrip recon={matchedRecon} />);
    const arRow = screen.getByTestId("recon-row-openAr");
    expect(arRow).toHaveClass("text-status-success");
  });

  it("renders an em-dash delta when matched", () => {
    render(<ReconciliationStrip recon={matchedRecon} />);
    expect(screen.getByTestId("recon-delta-openAr").textContent).toBe("—");
  });

  it("mirrors QB on the collected + customer rows (always matched)", () => {
    render(<ReconciliationStrip recon={matchedRecon} />);
    expect(screen.getByTestId("recon-row-collected24mo")).toHaveClass(
      "text-status-success"
    );
    expect(screen.getByTestId("recon-delta-collected24mo").textContent).toBe(
      "—"
    );
    expect(screen.getByTestId("recon-row-customers")).toHaveClass(
      "text-status-success"
    );
    expect(screen.getByTestId("recon-delta-customers").textContent).toBe("—");
  });

  it("marks a non-matching A/R row as a delta breach", () => {
    const breach: QboReconciliation = {
      ...matchedRecon,
      opsToBeOpenAr: 11500,
      arMatched: false,
    };
    render(<ReconciliationStrip recon={breach} />);
    const row = screen.getByTestId("recon-row-openAr");
    expect(row).toHaveClass("text-[#B58289]");
    expect(screen.getByTestId("recon-delta-openAr").textContent).toContain(
      "$500.00"
    );
  });
});
