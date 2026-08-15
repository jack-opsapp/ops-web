import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogKebab } from "@/components/catalog/catalog-kebab";
import { usePermissionStore } from "@/lib/store/permissions-store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/catalog/modals/manage-modal", () => ({
  ManageModal: () => null,
}));

vi.mock("@/components/catalog/modals/import-modal", () => ({
  ImportModal: () => null,
}));

vi.mock("@/components/catalog/modals/bulk-add-variants-dialog", () => ({
  BulkAddVariantsDialog: ({ onClose }: { onClose: () => void }) => (
    <div>
      Bulk workflow open
      <button type="button" onClick={onClose}>
        Close bulk workflow
      </button>
    </div>
  ),
}));

describe("CatalogKebab bulk variants entry", () => {
  beforeEach(() => {
    usePermissionStore.setState({
      permissions: new Map(),
      configuredPermissions: new Set(),
    });
  });

  async function openMenu() {
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());
  }

  it("shows the STOCK action only to stock operators with catalog.manage", async () => {
    usePermissionStore.setState({
      permissions: new Map([["catalog.manage", "all"]]),
    });
    const { rerender } = render(<CatalogKebab segment="stock" rows={[]} />);
    await openMenu();
    expect(screen.getByText("STOCK")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Bulk Add Variants" })
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    rerender(<CatalogKebab segment="products" rows={[]} />);
    await openMenu();
    expect(
      screen.queryByRole("menuitem", { name: "Bulk Add Variants" })
    ).not.toBeInTheDocument();
  });

  it("fails closed when catalog.manage is absent", async () => {
    render(<CatalogKebab segment="stock" rows={[]} />);
    await openMenu();
    expect(
      screen.queryByRole("menuitem", { name: "Bulk Add Variants" })
    ).not.toBeInTheDocument();
  });

  it("opens the guided workflow from the menu item", async () => {
    usePermissionStore.setState({
      permissions: new Map([["catalog.manage", "all"]]),
    });
    render(<CatalogKebab segment="stock" rows={[]} />);
    await openMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Bulk Add Variants" })
    );
    expect(await screen.findByText("Bulk workflow open")).toBeInTheDocument();
  });

  it("returns focus to More when the guided workflow closes", async () => {
    usePermissionStore.setState({
      permissions: new Map([["catalog.manage", "all"]]),
    });
    render(<CatalogKebab segment="stock" rows={[]} />);
    const moreButton = screen.getByRole("button", { name: "More" });

    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Bulk Add Variants" })
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Close bulk workflow" })
    );

    await waitFor(() => expect(moreButton).toHaveFocus());
  });
});
