import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AccountingView } from "../context-rail/accounting-view";
import type { ProjectDocument } from "@/lib/api/services/project-file-service";

/** Build a synthetic ProjectDocument fixture. Defaults cover the
 *  "happy path" for an estimate; callers override per scenario. */
function doc(overrides: Partial<ProjectDocument> & Pick<ProjectDocument, "id">): ProjectDocument {
  return {
    id: overrides.id,
    filename: overrides.filename ?? `Document ${overrides.id}.pdf`,
    sourceType: overrides.sourceType ?? "estimate",
    sourceId: overrides.sourceId ?? overrides.id,
    status: overrides.status ?? "draft",
    pdfStoragePath: overrides.pdfStoragePath ?? null,
    updatedAt: overrides.updatedAt ?? "2026-05-01T12:00:00.000Z",
    value: overrides.value ?? null,
  };
}

describe("<AccountingView>", () => {
  it("renders the ESTIMATES section header + one row per estimate", () => {
    render(
      <AccountingView
        documents={[
          doc({ id: "e1", sourceType: "estimate", filename: "EST-001.pdf" }),
          doc({ id: "e2", sourceType: "estimate", filename: "EST-002.pdf" }),
        ]}
      />,
    );
    expect(screen.getByTestId("accounting-view-estimates")).toBeInTheDocument();
    expect(screen.getByText("EST-001.pdf")).toBeInTheDocument();
    expect(screen.getByText("EST-002.pdf")).toBeInTheDocument();
  });

  it("renders the INVOICES section header + one row per invoice", () => {
    render(
      <AccountingView
        documents={[
          doc({ id: "i1", sourceType: "invoice", filename: "INV-001.pdf", status: "paid" }),
          doc({ id: "i2", sourceType: "invoice", filename: "INV-002.pdf", status: "sent" }),
          doc({ id: "i3", sourceType: "invoice", filename: "INV-003.pdf", status: "overdue" }),
        ]}
      />,
    );
    expect(screen.getByTestId("accounting-view-invoices")).toBeInTheDocument();
    expect(screen.getByText("INV-001.pdf")).toBeInTheDocument();
    expect(screen.getByText("INV-002.pdf")).toBeInTheDocument();
    expect(screen.getByText("INV-003.pdf")).toBeInTheDocument();
  });

  it("does NOT render the OTHER section when only estimates+invoices are present", () => {
    render(
      <AccountingView
        documents={[
          doc({ id: "e1", sourceType: "estimate" }),
          doc({ id: "i1", sourceType: "invoice", status: "paid" }),
        ]}
      />,
    );
    expect(screen.queryByTestId("accounting-view-other")).not.toBeInTheDocument();
  });

  it("status pill mapping: paid → PAID, outstanding → OUTSTANDING, overdue → OVERDUE", () => {
    render(
      <AccountingView
        documents={[
          doc({ id: "i1", sourceType: "invoice", status: "paid" }),
          doc({ id: "i2", sourceType: "invoice", status: "outstanding" }),
          doc({ id: "i3", sourceType: "invoice", status: "overdue" }),
        ]}
      />,
    );
    // Scope to the invoices section so we don't collide with the
    // [OUTSTANDING] / [OVERDUE] labels in the totals strip below.
    const invoicesSection = screen.getByTestId("accounting-view-invoices");
    expect(within(invoicesSection).getByText("[PAID]")).toBeInTheDocument();
    expect(within(invoicesSection).getByText("[OUTSTANDING]")).toBeInTheDocument();
    expect(within(invoicesSection).getByText("[OVERDUE]")).toBeInTheDocument();
  });

  it("totals strip: sums outstanding + recent-paid; mutes overdue cell when zero", () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    render(
      <AccountingView
        documents={[
          doc({
            id: "i1",
            sourceType: "invoice",
            status: "outstanding",
            value: 2847,
            updatedAt: recent,
          }),
          doc({
            id: "i2",
            sourceType: "invoice",
            status: "paid",
            value: 14200,
            updatedAt: recent,
          }),
        ]}
      />,
    );
    const strip = screen.getByTestId("accounting-totals");
    expect(strip).toHaveTextContent("$2,847");
    expect(strip).toHaveTextContent("$14,200");
    expect(strip).toHaveTextContent("$0");
    const overdueCell = screen.getByTestId("accounting-totals-overdue");
    expect(overdueCell.querySelector("span:last-child")?.className).toMatch(/text-text-mute/);
  });

  it("overdue muting flips off when overdue > 0", () => {
    render(
      <AccountingView
        documents={[
          doc({
            id: "i1",
            sourceType: "invoice",
            status: "overdue",
            value: 500,
          }),
        ]}
      />,
    );
    const overdueCell = screen.getByTestId("accounting-totals-overdue");
    const valueSpan = overdueCell.querySelector("span:last-child");
    expect(valueSpan?.className).toMatch(/text-rose/);
    expect(valueSpan?.className).not.toMatch(/text-text-mute/);
  });

  it("renders empty state when documents is empty", () => {
    render(<AccountingView documents={[]} />);
    expect(screen.getByText(/no financial documents/i)).toBeInTheDocument();
    expect(screen.queryByTestId("accounting-view-estimates")).not.toBeInTheDocument();
    expect(screen.queryByTestId("accounting-view-invoices")).not.toBeInTheDocument();
  });

  it("fires onOpenDocument with the row's ProjectDocument when clicked", () => {
    const onOpen = vi.fn();
    const target = doc({
      id: "e1",
      sourceType: "estimate",
      filename: "EST-clickable.pdf",
      status: "sent",
    });
    render(<AccountingView documents={[target]} onOpenDocument={onOpen} />);
    fireEvent.click(screen.getByText("EST-clickable.pdf"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(target);
  });

  it("estimate status mapping: draft / sent / accepted / declined", () => {
    render(
      <AccountingView
        documents={[
          doc({ id: "e1", sourceType: "estimate", status: "draft" }),
          doc({ id: "e2", sourceType: "estimate", status: "sent" }),
          doc({ id: "e3", sourceType: "estimate", status: "accepted" }),
          doc({ id: "e4", sourceType: "estimate", status: "declined" }),
        ]}
      />,
    );
    expect(screen.getByText("[DRAFT]")).toBeInTheDocument();
    expect(screen.getByText("[SENT]")).toBeInTheDocument();
    expect(screen.getByText("[ACCEPTED]")).toBeInTheDocument();
    expect(screen.getByText("[DECLINED]")).toBeInTheDocument();
  });
});
