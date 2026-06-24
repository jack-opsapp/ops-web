/**
 * Books SYNC segment (P3.1, one-CONNECT redesign) — the QuickBooks importer
 * lives at /books?segment=sync&view=import. With no provider connected the
 * segment shows the SINGLE connect call-to-action (no side-by-side provider
 * cards); once a QuickBooks provider is live, view=import mounts the importer.
 * Segment visibility itself is gated by BooksPage on
 * accounting.manage_connections (asserted in books-page).
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountingProvider, type AccountingConnection } from "@/lib/types/pipeline";

// Mutable connection list the hook mock reads — set per test. vi.hoisted keeps
// it reachable from the (hoisted) vi.mock factory below.
const h = vi.hoisted(() => ({ connections: [] as AccountingConnection[] }));

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

afterEach(() => {
  h.connections = [];
});

describe("Books SYNC segment", () => {
  it("shows the single CONNECT call-to-action when no provider is connected", () => {
    h.connections = [];
    render(
      <SyncSegment segmentControl={<div />} view="connections" onViewChange={vi.fn()} />,
    );
    // One-CONNECT entry point — not a side-by-side provider grid, and the
    // importer is not mounted until a provider is live.
    expect(screen.getByText("sync.connect.cta")).toBeInTheDocument();
    expect(screen.queryByTestId("qbo-import-tab")).not.toBeInTheDocument();
  });

  it("mounts the QuickBooks importer at view=import once connected", () => {
    h.connections = [CONNECTED_QB];
    render(<SyncSegment segmentControl={<div />} view="import" onViewChange={vi.fn()} />);
    expect(screen.getByTestId("qbo-import-tab")).toBeInTheDocument();
  });
});
