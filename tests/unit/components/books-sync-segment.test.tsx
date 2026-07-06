/**
 * Books SYNC segment (P3.1, one-CONNECT redesign) — the QuickBooks importer
 * lives at /books?segment=sync&view=import. With no provider connected the
 * segment shows the SINGLE connect call-to-action (no side-by-side provider
 * cards); once a QuickBooks provider is live, view=import mounts the importer.
 * Segment visibility itself is gated by BooksPage on
 * accounting.manage_connections (asserted in books-page).
 *
 * Also asserts the post-OAuth landing contract (bug eb70d803): the provider
 * callback redirects to /books?segment=sync&connected=<provider> (or
 * ?status=error&message=<code>) and the segment consumes it exactly once —
 * refetch connections, toast the outcome, strip the params.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountingProvider, type AccountingConnection } from "@/lib/types/pipeline";
import { queryKeys } from "@/lib/api/query-client";

// Mutable state the hoisted mock factories read — set per test.
const h = vi.hoisted(() => ({
  connections: [] as unknown[],
  search: "",
  replace: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastPlain: vi.fn(),
}));

vi.mock("@/components/accounting/qbo/quickbooks-import-tab", () => ({
  QuickBooksImportTab: () => <div data-testid="qbo-import-tab">IMPORT</div>,
}));
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
  useLocale: () => ({ locale: "en" }),
}));
// SyncSegment imports these hooks from the specific module, not the barrel,
// so the mock must target the same path or the real (QueryClient-dependent)
// hooks run.
vi.mock("@/lib/hooks/use-accounting", () => ({
  useAccountingConnections: () => ({ data: h.connections, isLoading: false }),
  useInitiateOAuth: () => ({ mutate: vi.fn(), isPending: false }),
  useDisconnectProvider: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSyncEnabled: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSyncMode: () => ({ mutate: vi.fn(), isPending: false, data: undefined }),
  useTriggerSync: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useSyncHistory: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "co" } }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(h.search),
  useRouter: () => ({ replace: h.replace }),
  usePathname: () => "/books",
}));
vi.mock("sonner", () => {
  const toast = Object.assign(
    (...args: unknown[]) => h.toastPlain(...args),
    {
      success: (...args: unknown[]) => h.toastSuccess(...args),
      error: (...args: unknown[]) => h.toastError(...args),
    },
  );
  return { toast };
});

import { SyncSegment } from "@/components/books/segments/sync-segment";

const CONNECTED_QB: AccountingConnection = {
  id: "conn-1",
  companyId: "co",
  provider: AccountingProvider.QuickBooks,
  providerEnvironment: "production",
  accessToken: "tok",
  refreshToken: "ref",
  tokenExpiresAt: null,
  realmId: "realm-1",
  isConnected: true,
  lastSyncAt: null,
  syncEnabled: true,
  syncDirection: "pull_only",
  propagateDeletes: false,
  webhookVerifierToken: null,
  createdAt: null,
  updatedAt: null,
};

function renderSegment(view: "connections" | "import" = "connections") {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <SyncSegment
        metrics={null}
        segmentControl={<div />}
        view={view}
        onViewChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

afterEach(() => {
  h.connections = [];
  h.search = "";
  vi.clearAllMocks();
});

describe("Books SYNC segment", () => {
  it("shows the single CONNECT call-to-action when no provider is connected", () => {
    h.connections = [];
    renderSegment("connections");
    // One-CONNECT entry point — not a side-by-side provider grid, and the
    // importer is not mounted until a provider is live.
    expect(screen.getByText("sync.connect.cta")).toBeInTheDocument();
    expect(screen.queryByTestId("qbo-import-tab")).not.toBeInTheDocument();
  });

  it("mounts the QuickBooks importer at view=import once connected", () => {
    h.connections = [CONNECTED_QB];
    renderSegment("import");
    expect(screen.getByTestId("qbo-import-tab")).toBeInTheDocument();
  });
});

describe("Books SYNC segment — post-OAuth landing (eb70d803)", () => {
  it("?connected=quickbooks → refetch connections, success toast, params stripped", () => {
    h.connections = [CONNECTED_QB];
    h.search = "segment=sync&connected=quickbooks";
    const { invalidateSpy } = renderSegment("connections");

    // The connections query is refetched so the badge/panel reflect the row
    // the callback just flipped to is_connected=true.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.accounting.connections("co"),
    });
    expect(h.toastSuccess).toHaveBeenCalledWith("sync.toast.connected");
    expect(h.toastError).not.toHaveBeenCalled();
    // connected/status/message are stripped; the surviving params remain.
    expect(h.replace).toHaveBeenCalledWith("/books?segment=sync", { scroll: false });
  });

  it("?status=error&message=access_denied → neutral cancelled toast", () => {
    h.search = "segment=sync&status=error&message=access_denied";
    renderSegment("connections");

    expect(h.toastPlain).toHaveBeenCalledWith("sync.toast.connectCancelled");
    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.replace).toHaveBeenCalledWith("/books?segment=sync", { scroll: false });
  });

  it("?status=error&message=csrf_mismatch → failure toast", () => {
    h.search = "segment=sync&status=error&message=csrf_mismatch";
    renderSegment("connections");

    expect(h.toastError).toHaveBeenCalledWith("sync.toast.connectFailed");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.replace).toHaveBeenCalledWith("/books?segment=sync", { scroll: false });
  });

  it("no outcome params → no toast, no URL rewrite", () => {
    h.search = "segment=sync";
    const { invalidateSpy } = renderSegment("connections");

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.toastPlain).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
  });
});
