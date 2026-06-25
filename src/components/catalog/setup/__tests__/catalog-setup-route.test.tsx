import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The route mounts several useQuery/useMutation hooks (baseline, lock, lookups,
// existing-rows, QB pull) beyond the few mocked below — they need a QueryClient
// in scope or the render throws "No QueryClient" before the permission gate runs.
function renderRoute() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CatalogSetupRoute />
    </QueryClientProvider>,
  );
}

const { canMock, pushMock } = vi.hoisted(() => ({
  canMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (sel: (s: { can: typeof canMock }) => unknown) =>
    sel({ can: canMock }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
// Provide a company/user so the prerequisite gate (companyExists, subscription)
// passes and the wizard mounts — supports both selector and no-arg call styles.
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = {
      company: { id: "co-1", subscriptionStatus: "active" },
      currentUser: { id: "u-1", role: "owner" },
    };
    return sel ? sel(state) : state;
  },
}));
vi.mock("@/lib/hooks/use-inventory-mode", () => ({
  useInventoryMode: () => ({ data: { mode: "off", tracked: false } }),
}));
vi.mock("@/lib/hooks/use-commit-catalog-setup", () => ({
  useCommitCatalogSetup: () => ({ mutate: vi.fn(), isPending: false }),
  CommitError: class extends Error {},
}));
vi.mock("@/lib/hooks/use-setup-agent", () => ({
  useSetupAgent: () => ({ mutate: vi.fn(), isPending: false }),
  AgentUnavailableError: class extends Error {},
}));
vi.mock("@/components/catalog-setup/setup-wizard-shell", () => ({
  SetupWizardShell: (props: { inventoryTracked?: boolean }) => (
    <div data-testid="wizard-shell-stub" data-tracked={String(props.inventoryTracked)} />
  ),
}));

import { CatalogSetupRoute } from "@/components/catalog/setup/catalog-setup-route";

beforeEach(() => canMock.mockReset());

describe("CatalogSetupRoute permission gate", () => {
  it("renders // NO ACCESS without catalog.run_setup", () => {
    canMock.mockReturnValue(false);
    renderRoute();
    expect(screen.getByTestId("catalog-setup-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-shell-stub")).toBeNull();
  });

  it("mounts the wizard when catalog.run_setup is granted", () => {
    canMock.mockImplementation(
      (p: string) => p === "catalog.run_setup" || p === "catalog.products.manage",
    );
    renderRoute();
    expect(screen.getByTestId("wizard-shell-stub")).toBeInTheDocument();
  });

  it("passes inventoryTracked=false when inventory is off (STOCK omitted)", () => {
    canMock.mockReturnValue(true);
    renderRoute();
    expect(screen.getByTestId("wizard-shell-stub")).toHaveAttribute(
      "data-tracked",
      "false",
    );
  });
});
