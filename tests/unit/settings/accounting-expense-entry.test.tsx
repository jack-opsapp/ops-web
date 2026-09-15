import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AccountingTab } from "@/components/settings/accounting-tab";
import en from "@/i18n/dictionaries/en/settings.json";

const state = vi.hoisted(() => ({ params: new URLSearchParams(), connections: [{ id: "actual-connection-1", provider: "quickbooks", isConnected: true, syncEnabled: true, syncDirection: "pull_only", propagateDeletes: false }] }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params }));
vi.mock("@/components/settings/expense-accounting-issues", () => ({ ExpenseAccountingIssues: ({connectionId}: {connectionId:string}) => <div data-testid="expense-issues" data-connection-id={connectionId} /> }));
vi.mock("@/i18n/client", () => ({ useDictionary: () => ({ t: (key: string) => en[key as keyof typeof en] ?? key }) }));
vi.mock("@/lib/store/permissions-store", () => ({ usePermissionStore: (selector: (state: { can: () => boolean }) => unknown) => selector({ can: () => true }) }));
vi.mock("@/lib/store/auth-store", () => ({ useAuthStore: () => ({ company: { id: "company-1" } }) }));
vi.mock("@/components/settings/expense-accounting-settings", () => ({
  ExpenseAccountingSettings: ({ companyId, connectionId }: { companyId: string; connectionId: string }) => <div data-testid="expense-setup" data-company-id={companyId} data-connection-id={connectionId}>Expense account setup</div>,
}));
vi.mock("@/lib/hooks", () => ({
  useAccountingConnections: () => ({ data: state.connections }),
  useInitiateOAuth: () => ({ mutate: vi.fn() }),
  useDisconnectProvider: () => ({ mutate: vi.fn() }),
  useUpdateSyncEnabled: () => ({ mutate: vi.fn() }),
  useUpdateSyncMode: () => ({ mutate: vi.fn() }),
  useTriggerSync: () => ({ mutate: vi.fn() }),
  useSyncHistory: () => ({ data: [] }),
  useAccountingSyncIssues: () => ({ data: [] }),
}));

beforeEach(() => { state.params = new URLSearchParams(); state.connections = [{ id: "actual-connection-1", provider: "quickbooks", isConnected: true, syncEnabled: true, syncDirection: "pull_only", propagateDeletes: false }]; });
describe("accounting settings entry", () => {
  it("opens the exact Sage connection from its notification", () => {
    state.connections.push({ ...state.connections[0], id: "sage-connection", provider: "sage" });
    state.params = new URLSearchParams("expenseConnection=sage-connection");
    render(<AccountingTab />);
    expect(screen.getByTestId("expense-issues")).toHaveAttribute("data-connection-id", "sage-connection");
  });
  it("retains read-only issue visibility after the notified connection disconnects", () => {
    state.connections[0].isConnected = false;
    state.params = new URLSearchParams("expenseConnection=actual-connection-1");
    render(<AccountingTab />);
    expect(screen.getByTestId("expense-issues")).toHaveAttribute("data-connection-id", "actual-connection-1");
    expect(screen.queryByTestId("expense-setup")).toBeNull();
  });
  it("keeps expense setup inside the existing management dialog and passes the real connection", () => {
    render(<AccountingTab />);
    expect(screen.queryByTestId("expense-setup")).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    const setup = screen.getByTestId("expense-setup");
    expect(setup.closest('[role="dialog"]')).not.toBeNull();
    expect(setup).toHaveAttribute("data-company-id", "company-1");
    expect(setup).toHaveAttribute("data-connection-id", "actual-connection-1");
  });
});
