import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/accounting/qbo/quickbooks-import-tab", () => ({
  QuickBooksImportTab: () => <div data-testid="qbo-import-tab">IMPORT</div>,
}));
vi.mock("@/components/expenses/expense-review-dashboard", () => ({
  ExpenseReviewDashboard: () => <div />,
}));
vi.mock("@/components/metrics", () => ({ MetricsHeader: () => <div /> }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/hooks/use-page-title", () => ({ usePageTitle: () => {} }));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
  useLocale: () => ({ locale: "en" }),
}));
vi.mock("@/lib/hooks", () => ({
  useAccountingConnections: () => ({ data: [], isLoading: false }),
  useInitiateOAuth: () => ({ mutate: vi.fn() }),
  useDisconnectProvider: () => ({ mutate: vi.fn() }),
  useTriggerSync: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useSyncHistory: () => ({ data: [], isLoading: false }),
  useInvoices: () => ({ data: [] }),
  useClients: () => ({ data: { clients: [] } }),
  useAccountingMetrics: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "co" } }),
}));

const canMock = vi.fn();
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (sel: (s: { can: (p: string) => boolean }) => unknown) =>
    sel({ can: canMock }),
}));

import AccountingPage from "@/app/(dashboard)/accounting/page";

describe("AccountingPage import tab", () => {
  it("hides the import tab without accounting.manage_connections", () => {
    canMock.mockReturnValue(false);
    render(<AccountingPage />);
    expect(screen.queryByText("tabs.import")).not.toBeInTheDocument();
  });

  it("shows and renders the import tab with the permission", () => {
    canMock.mockImplementation((p: string) => p === "accounting.manage_connections");
    render(<AccountingPage />);
    const tabBtn = screen.getByText("tabs.import");
    fireEvent.click(tabBtn);
    expect(screen.getByTestId("qbo-import-tab")).toBeInTheDocument();
  });
});
