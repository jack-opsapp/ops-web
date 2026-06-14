import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { canMock, pushMock } = vi.hoisted(() => ({
  canMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (sel: (s: { can: typeof canMock }) => unknown) =>
    sel({ can: canMock }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
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
    render(<CatalogSetupRoute />);
    expect(screen.getByTestId("catalog-setup-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-shell-stub")).toBeNull();
  });

  it("mounts the wizard when catalog.run_setup is granted", () => {
    canMock.mockImplementation(
      (p: string) => p === "catalog.run_setup" || p === "products.manage",
    );
    render(<CatalogSetupRoute />);
    expect(screen.getByTestId("wizard-shell-stub")).toBeInTheDocument();
  });

  it("passes inventoryTracked=false when inventory is off (STOCK omitted)", () => {
    canMock.mockReturnValue(true);
    render(<CatalogSetupRoute />);
    expect(screen.getByTestId("wizard-shell-stub")).toHaveAttribute(
      "data-tracked",
      "false",
    );
  });
});
