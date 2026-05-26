import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AccountingView } from "../context-rail/accounting-view";
import type { ProjectDocument } from "@/lib/api/services/project-file-service";

/** Build a synthetic ProjectDocument fixture. Defaults cover the
 *  "happy path" for an estimate; callers override per scenario. */
function doc(
  overrides: Partial<ProjectDocument> & Pick<ProjectDocument, "id">
): ProjectDocument {
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
          doc({
            id: "e1",
            sourceType: "estimate",
            filename: "Estimate EST-001.pdf",
          }),
          doc({
            id: "e2",
            sourceType: "estimate",
            filename: "Estimate EST-002.pdf",
          }),
        ]}
      />
    );
    expect(screen.getByTestId("accounting-view-estimates")).toBeInTheDocument();
    expect(screen.getByText("EST-001")).toBeInTheDocument();
    expect(screen.getByText("EST-002")).toBeInTheDocument();
  });

  it("renders the INVOICES section header + one row per invoice", () => {
    render(
      <AccountingView
        documents={[
          doc({
            id: "i1",
            sourceType: "invoice",
            filename: "Invoice INV-001.pdf",
            status: "paid",
          }),
          doc({
            id: "i2",
            sourceType: "invoice",
            filename: "Invoice INV-002.pdf",
            status: "sent",
          }),
          doc({
            id: "i3",
            sourceType: "invoice",
            filename: "Invoice INV-003.pdf",
            status: "overdue",
          }),
        ]}
      />
    );
    expect(screen.getByTestId("accounting-view-invoices")).toBeInTheDocument();
    expect(screen.getByText("INV-001")).toBeInTheDocument();
    expect(screen.getByText("INV-002")).toBeInTheDocument();
    expect(screen.getByText("INV-003")).toBeInTheDocument();
  });

  it("does NOT render the OTHER section when only estimates+invoices are present", () => {
    render(
      <AccountingView
        documents={[
          doc({ id: "e1", sourceType: "estimate" }),
          doc({ id: "i1", sourceType: "invoice", status: "paid" }),
        ]}
      />
    );
    expect(
      screen.queryByTestId("accounting-view-other")
    ).not.toBeInTheDocument();
  });

  it("status tone mapping: paid → olive, outstanding → tan, overdue → rose", () => {
    render(
      <AccountingView
        documents={[
          doc({ id: "i1", sourceType: "invoice", status: "paid" }),
          doc({ id: "i2", sourceType: "invoice", status: "outstanding" }),
          doc({ id: "i3", sourceType: "invoice", status: "overdue" }),
        ]}
      />
    );
    // Scope to the invoices section so we don't collide with the
    // [OUTSTANDING] / [OVERDUE] labels in the totals strip below.
    const invoicesSection = screen.getByTestId("accounting-view-invoices");
    expect(within(invoicesSection).getByText("[PAID]")).toHaveClass(
      "text-olive"
    );
    expect(within(invoicesSection).getByText("[OUTSTANDING]")).toHaveClass(
      "text-tan"
    );
    expect(within(invoicesSection).getByText("[OVERDUE]")).toHaveClass(
      "text-rose"
    );
  });

  it("totals banner sums estimates, invoices, outstanding, paid, and overdue", () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    render(
      <AccountingView
        documents={[
          doc({
            id: "e1",
            sourceType: "estimate",
            status: "sent",
            value: 18400,
            updatedAt: recent,
          }),
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
          doc({
            id: "i3",
            sourceType: "invoice",
            status: "overdue",
            value: 500,
            updatedAt: recent,
          }),
        ]}
      />
    );
    const strip = screen.getByTestId("accounting-totals");
    expect(strip).toHaveTextContent("$18,400");
    expect(strip).toHaveTextContent("$17,547");
    expect(strip).toHaveTextContent("$2,847");
    expect(strip).toHaveTextContent("$14,200");
    expect(strip).toHaveTextContent("$500");
  });

  it("renders zero for known-empty invoice buckets and dash for missing numeric data", () => {
    render(
      <AccountingView
        documents={[
          doc({
            id: "i1",
            sourceType: "invoice",
            status: "paid",
            value: 500,
          }),
          doc({ id: "e1", sourceType: "estimate", value: null }),
        ]}
      />
    );
    expect(screen.getByTestId("accounting-totals-estimates")).toHaveTextContent(
      "—"
    );
    expect(
      screen.getByTestId("accounting-totals-outstanding")
    ).toHaveTextContent("$0");
    const overdueCell = screen.getByTestId("accounting-totals-overdue");
    const valueSpan = overdueCell.querySelector("span:last-child");
    expect(overdueCell).toHaveTextContent("$0");
    expect(valueSpan?.className).toMatch(/text-text-mute/);
  });

  it("renders empty state when documents is empty", () => {
    render(<AccountingView documents={[]} />);
    expect(screen.getByText(/no financial documents/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId("accounting-view-estimates")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("accounting-view-invoices")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("accounting-totals")).toHaveTextContent("—");
  });

  it("fires onOpenDocument with the row's ProjectDocument when clicked", () => {
    const onOpen = vi.fn();
    const target = doc({
      id: "e1",
      sourceType: "estimate",
      filename: "Estimate EST-clickable.pdf",
      status: "sent",
    });
    render(<AccountingView documents={[target]} onOpenDocument={onOpen} />);
    fireEvent.click(screen.getByTestId("accounting-document-row-e1"));
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
      />
    );
    expect(screen.getByText("[DRAFT]")).toBeInTheDocument();
    expect(screen.getByText("[SENT]")).toHaveClass("text-tan");
    expect(screen.getByText("[ACCEPTED]")).toBeInTheDocument();
    expect(screen.getByText("[DECLINED]")).toBeInTheDocument();
  });

  it("renders row hierarchy with doc type, reference, status, value, and updated date", () => {
    render(
      <AccountingView
        documents={[
          doc({
            id: "i1",
            sourceType: "invoice",
            filename: "Invoice INV-1188.pdf",
            status: "sent",
            value: 9400,
            updatedAt: "2026-05-07T12:00:00.000Z",
          }),
        ]}
      />
    );
    const row = screen.getByTestId("accounting-document-row-i1");
    expect(within(row).getByText("INVOICE")).toBeInTheDocument();
    expect(within(row).getByText("INV-1188")).toBeInTheDocument();
    expect(within(row).getByText("[OUTSTANDING]")).toBeInTheDocument();
    expect(within(row).getByText("$9,400")).toBeInTheDocument();
    expect(within(row).getByText("MAY 7")).toBeInTheDocument();
  });

  it("keeps provider attachments out of ACCOUNTING", () => {
    render(
      <AccountingView
        documents={[
          doc({
            id: "email-att-1",
            sourceType: "email_attachment",
            filename: "supplier-cut-sheet.pdf",
            status: null,
          }),
        ]}
      />
    );
    expect(screen.getByText(/no financial documents/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId("accounting-view-estimates")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("accounting-view-invoices")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("accounting-view-other")
    ).not.toBeInTheDocument();
  });
});
