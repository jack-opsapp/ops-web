import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThreadColumnHeader } from "../thread-column-header";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    dict: {},
  }),
  useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));

describe("<ThreadColumnHeader>", () => {
  it("renders only the three primary IA filters in the rail menu", async () => {
    const user = userEvent.setup();
    render(
      <ThreadColumnHeader
        filter="CLIENTS"
        defaultFilter="CLIENTS"
        onDefaultFilterChange={() => {}}
        onFilterChange={() => {}}
        searchValue=""
        onSearchChange={() => {}}
        onRefresh={() => {}}
        onOpenArchived={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Filter inbox" }));

    expect(screen.getByRole("menuitem", { name: /CLIENTS/ })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /EVERYTHING ELSE/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^ALL/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /YOUR MOVE/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^WAITING/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^ARCHIVED/ })).toBeNull();
  });

  it("offers a compact star action for setting any primary filter as default", async () => {
    const user = userEvent.setup();
    const onDefaultFilterChange = vi.fn();
    const onFilterChange = vi.fn();
    render(
      <ThreadColumnHeader
        filter="CLIENTS"
        defaultFilter="CLIENTS"
        onDefaultFilterChange={onDefaultFilterChange}
        onFilterChange={onFilterChange}
        searchValue=""
        onSearchChange={() => {}}
        onRefresh={() => {}}
        onOpenArchived={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Filter inbox" }));
    await user.click(
      screen.getByRole("button", {
        name: "Set EVERYTHING ELSE as default inbox view",
      }),
    );

    expect(onDefaultFilterChange).toHaveBeenCalledWith("EVERYTHING_ELSE");
    expect(onFilterChange).not.toHaveBeenCalled();
  });

  it("marks the starred filter without inflating the header hit target", () => {
    render(
      <ThreadColumnHeader
        filter="EVERYTHING_ELSE"
        defaultFilter="EVERYTHING_ELSE"
        onDefaultFilterChange={() => {}}
        onFilterChange={() => {}}
        searchValue=""
        onSearchChange={() => {}}
        onRefresh={() => {}}
        onOpenArchived={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    const currentDefault = screen.getByRole("button", {
      name: "Default inbox view: EVERYTHING ELSE",
    });
    expect(currentDefault.className).toContain("h-4");
    expect(currentDefault.className).toContain("w-4");
  });
});
