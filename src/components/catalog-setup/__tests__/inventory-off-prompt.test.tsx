import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    dict: {},
  }),
  useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));

import { InventoryOffPrompt } from "../inventory-off-prompt";

describe("<InventoryOffPrompt>", () => {
  it("renders nothing when closed", () => {
    render(
      <InventoryOffPrompt
        open={false}
        stockItemCount={5}
        onTrack={() => {}}
        onKeepAsProducts={() => {}}
      />,
    );
    expect(screen.queryByTestId("inventory-off-prompt")).not.toBeInTheDocument();
  });

  it("offers track vs keep-as-products when stock arrives with inventory off", () => {
    render(
      <InventoryOffPrompt
        open
        stockItemCount={5}
        onTrack={() => {}}
        onKeepAsProducts={() => {}}
      />,
    );
    expect(screen.getByText(/track inventory/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /track it/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /keep as products/i }),
    ).toBeInTheDocument();
  });

  it("surfaces the stock count (quantities not silently dropped)", () => {
    render(
      <InventoryOffPrompt
        open
        stockItemCount={5}
        onTrack={() => {}}
        onKeepAsProducts={() => {}}
      />,
    );
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("fires onTrack", () => {
    const onTrack = vi.fn();
    render(
      <InventoryOffPrompt
        open
        stockItemCount={3}
        onTrack={onTrack}
        onKeepAsProducts={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /track it/i }));
    expect(onTrack).toHaveBeenCalledTimes(1);
  });

  it("fires onKeepAsProducts (quantities surfaced, not silently dropped)", () => {
    const onKeep = vi.fn();
    render(
      <InventoryOffPrompt
        open
        stockItemCount={3}
        onTrack={() => {}}
        onKeepAsProducts={onKeep}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /keep as products/i }));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });
});
