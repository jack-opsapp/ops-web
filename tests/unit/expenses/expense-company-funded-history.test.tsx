import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BatchList } from "@/components/expenses/batch-list";
import { groupPaidByMonth } from "@/lib/utils/expense-buckets";
import { ExpenseBatchStatus, type ExpenseBatch } from "@/lib/types/expense-approval";
import en from "@/i18n/dictionaries/en/books.json";
import es from "@/i18n/dictionaries/es/books.json";

let locale: "en" | "es" = "en";
vi.mock("@/i18n/client", () => ({
  useLocale: () => ({ locale }),
  useDictionary: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const dictionary: Record<string, string> = locale === "en" ? en : es;
      return Object.entries(params ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), dictionary[key] ?? key);
    },
  }),
}));

const row: ExpenseBatch = {
  id: "batch-a", companyId: "company-a", batchNumber: "EXP-001",
  periodStart: "2026-07-01", periodEnd: "2026-07-07",
  status: ExpenseBatchStatus.Approved, submittedBy: "crew-a",
  reviewedBy: "reviewer-a", reviewedAt: "2026-07-08T12:00:00Z",
  totalAmount: 145, approvedAmount: 145, reimbursementAmount: 0,
  parentBatchId: null, amendmentNumber: 0, reviewNotes: null,
  paidAt: null, paidBy: null, createdAt: "2026-07-02T12:00:00Z",
  submitter: { id: "crew-a", firstName: "Alex", lastName: "Crew", email: null, profileImageUrl: null },
};

describe("company-funded expense history", () => {
  it.each(["en", "es"] as const)("keeps the approved receipt discoverable with its full total in %s", (language) => {
    locale = language;
    const onSelect = vi.fn();
    const onMarkPaid = vi.fn();
    render(
      <BatchList
        bucket="paid" reviewGroups={[]} payGroups={[]} crewBatches={[]}
        paidMonths={groupPaidByMonth([row])} lineStats={new Map([[row.id, { count: 1, flagged: 0 }]])}
        selectedId={null} onSelect={onSelect} canReview busyIds={new Set()}
        fillingCount={0} graceDays={7}
        actions={{ onMarkPaid, onApproveBatch: vi.fn(), onApprovePerson: vi.fn(), onPayPerson: vi.fn() }}
      />,
    );
    const historyRow = screen.getByRole("button");
    expect(within(historyRow).getByText(language === "en" ? "APPROVED" : "APROBADO")).toBeInTheDocument();
    expect(within(historyRow).getByText("Alex Crew")).toBeInTheDocument();
    expect(historyRow.textContent).toContain("145");
    expect(within(historyRow).queryByRole("button")).toBeNull();
    fireEvent.click(historyRow);
    expect(onSelect).toHaveBeenCalledWith("batch-a");
    expect(onMarkPaid).not.toHaveBeenCalled();
  });
});
