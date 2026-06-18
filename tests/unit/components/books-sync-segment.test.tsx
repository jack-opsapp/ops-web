/**
 * Books SYNC segment (P3.1) — replaces the retired accounting-page
 * import-tab test. The QuickBooks import lives at
 * /books?segment=sync&view=import; segment visibility itself is gated by
 * BooksPage on accounting.manage_connections (asserted via SEGMENT gating
 * in books-page), so this suite covers the view toggle + import mount.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/accounting/qbo/quickbooks-import-tab", () => ({
  QuickBooksImportTab: () => <div data-testid="qbo-import-tab">IMPORT</div>,
}));
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
}));
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => ({ company: { id: "co" } }),
}));

import { SyncSegment } from "@/components/books/segments/sync-segment";

describe("Books SYNC segment", () => {
  it("renders connections by default with the import toggle", () => {
    const onViewChange = vi.fn();
    render(
      <SyncSegment segmentControl={<div />} view="connections" onViewChange={onViewChange} />,
    );
    expect(screen.getByText("integrations.syncHistory")).toBeInTheDocument();
    expect(screen.queryByTestId("qbo-import-tab")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("view.import"));
    expect(onViewChange).toHaveBeenCalledWith("import");
  });

  it("mounts the QuickBooks import at view=import", () => {
    render(<SyncSegment segmentControl={<div />} view="import" onViewChange={vi.fn()} />);
    expect(screen.getByTestId("qbo-import-tab")).toBeInTheDocument();
    expect(screen.queryByText("integrations.syncHistory")).not.toBeInTheDocument();
  });
});
