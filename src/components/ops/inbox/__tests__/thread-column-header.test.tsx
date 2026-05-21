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

  it("offers compact pin actions for setting any primary filter as default", async () => {
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
    expect(document.body.querySelector("[data-default-filter-star]")).toBeNull();
    expect(document.body.querySelectorAll("[data-default-filter-pin]")).toHaveLength(3);
    await user.click(
      screen.getByRole("button", {
        name: "Set EVERYTHING ELSE as default inbox view",
      }),
    );

    expect(onDefaultFilterChange).toHaveBeenCalledWith("EVERYTHING_ELSE");
    expect(onFilterChange).not.toHaveBeenCalled();
  });

  it("does not render a standalone default control beside the rail chip", () => {
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

    expect(screen.queryByRole("button", {
      name: "Default inbox view: EVERYTHING ELSE",
    })).not.toBeInTheDocument();
  });
});
