import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { canMock } = vi.hoisted(() => ({ canMock: vi.fn() }));
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (sel: (s: { can: typeof canMock }) => unknown) =>
    sel({ can: canMock }),
}));

import { CatalogSetupLauncher } from "@/components/catalog/setup/catalog-setup-launcher";

beforeEach(() => canMock.mockReset());

describe("CatalogSetupLauncher", () => {
  it("renders the start CTA → /catalog/setup, the headline, and a quiet exit when permitted", () => {
    canMock.mockImplementation((p: string) => p === "catalog.run_setup");
    render(<CatalogSetupLauncher />);

    const cta = screen.getByRole("link", { name: /start setup/i });
    expect(cta).toHaveAttribute("href", "/catalog/setup");
    expect(screen.getByText("Stand up your catalog")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /set up later/i }),
    ).toBeInTheDocument();
  });

  it("renders nothing for a user without catalog.run_setup (no dead CTA)", () => {
    canMock.mockReturnValue(false);
    const { container } = render(<CatalogSetupLauncher />);
    expect(container).toBeEmptyDOMElement();
  });

  it("fires onDismiss when 'set up later' is clicked", async () => {
    canMock.mockReturnValue(true);
    const onDismiss = vi.fn();
    render(<CatalogSetupLauncher onDismiss={onDismiss} />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /set up later/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("puts the accent only on the CTA, not the exit", () => {
    canMock.mockReturnValue(true);
    render(<CatalogSetupLauncher />);
    expect(screen.getByTestId("catalog-setup-start").className).toMatch(
      /ops-accent/,
    );
    expect(screen.getByTestId("catalog-setup-later").className).not.toMatch(
      /ops-accent/,
    );
  });
});
