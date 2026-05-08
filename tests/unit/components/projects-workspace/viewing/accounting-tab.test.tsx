import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockPipeline = vi.fn();
const mockLedger = vi.fn();

vi.mock("@/lib/hooks/use-project-pipeline", () => ({
  useProjectPipeline: () => mockPipeline(),
}));
vi.mock("@/lib/hooks/use-project-ledger", () => ({
  useProjectLedger: () => mockLedger(),
}));

const { AccountingTab } = await import(
  "@/components/ops/projects/workspace/viewing/accounting-tab"
);

describe("<AccountingTab>", () => {
  beforeEach(() => {
    mockPipeline.mockReturnValue({
      data: {
        quoted: { total: 12500, recordId: "Q-1024" },
        invoiced: { total: 8000, recordId: "I-2050", changeOrdersCount: 2 },
        received: { total: 4000, recordId: null, depositPct: 50 },
        outstanding: { total: 4000, dueDate: "2026-06-01", daysAged: 12 },
      },
      isLoading: false,
    });
    mockLedger.mockReturnValue({
      data: [
        {
          recordId: "Q-1024",
          description: "Phase 2 estimate",
          status: "approved",
          statusTone: "olive",
          date: "2026-05-01",
          amount: 12500,
          amountTone: "text",
          source: "estimate",
        },
        {
          recordId: "PMT-001",
          description: "Payment for I-2050",
          status: "received",
          statusTone: "olive",
          date: "2026-05-04",
          amount: -4000,
          amountTone: "olive",
          source: "payment",
        },
      ],
      isLoading: false,
    });
  });

  it("renders the 4-cell pipeline grid", () => {
    render(<AccountingTab projectId="p1" />);
    expect(screen.getByTestId("pipeline-cell-quoted")).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-cell-invoiced")).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-cell-received")).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-cell-outstanding")).toBeInTheDocument();
  });

  it("renders quoted total as a USD currency value", () => {
    render(<AccountingTab projectId="p1" />);
    expect(screen.getByTestId("pipeline-cell-quoted")).toHaveTextContent("$12,500.00");
  });

  it("renders invoiced change-order count when changeOrdersCount > 0", () => {
    render(<AccountingTab projectId="p1" />);
    expect(screen.getByTestId("pipeline-cell-invoiced")).toHaveTextContent("+2 CO");
  });

  it("renders received deposit pct when depositPct is set", () => {
    render(<AccountingTab projectId="p1" />);
    expect(screen.getByTestId("pipeline-cell-received")).toHaveTextContent("50% DEPOSIT");
  });

  it("renders outstanding age tag when daysAged > 0", () => {
    render(<AccountingTab projectId="p1" />);
    expect(screen.getByTestId("pipeline-cell-outstanding")).toHaveTextContent("12D OVERDUE");
  });

  it("renders an em-dash for zero-amount cells", () => {
    mockPipeline.mockReturnValue({
      data: {
        quoted: { total: 0, recordId: null },
        invoiced: { total: 0, recordId: null, changeOrdersCount: 0 },
        received: { total: 0, recordId: null, depositPct: null },
        outstanding: { total: 0, dueDate: null, daysAged: null },
      },
      isLoading: false,
    });
    render(<AccountingTab projectId="p1" />);
    const cells = [
      "pipeline-cell-quoted",
      "pipeline-cell-invoiced",
      "pipeline-cell-received",
      "pipeline-cell-outstanding",
    ];
    for (const id of cells) {
      expect(screen.getByTestId(id)).toHaveTextContent("—");
    }
  });

  it("renders one ledger row per entry, in order", () => {
    render(<AccountingTab projectId="p1" />);
    const rows = screen.getAllByTestId("ledger-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-source", "estimate");
    expect(rows[1]).toHaveAttribute("data-source", "payment");
  });

  it("renders payment amounts with a leading '-' sign", () => {
    render(<AccountingTab projectId="p1" />);
    const paymentRow = screen
      .getAllByTestId("ledger-row")
      .find((r) => r.getAttribute("data-source") === "payment");
    expect(paymentRow).toBeDefined();
    expect(paymentRow!.textContent).toContain("-$4,000.00");
  });

  it("renders the empty ledger state when rows is empty", () => {
    mockLedger.mockReturnValue({ data: [], isLoading: false });
    render(<AccountingTab projectId="p1" />);
    expect(screen.getByText(/No ledger entries yet/i)).toBeInTheDocument();
  });
});
