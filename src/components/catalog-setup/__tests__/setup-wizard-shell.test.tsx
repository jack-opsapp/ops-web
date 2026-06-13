import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Match the slice's harness: snap all motion (reduced) so AnimatePresence swaps
// and stamp/entry variants resolve instantly, and stub the async dictionary so
// strings resolve to their English fallbacks synchronously.
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return { ...actual, useReducedMotion: () => true };
});

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    dict: {},
  }),
  useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));

import { SetupWizardShell } from "../setup-wizard-shell";
import { useCatalogSetupStore } from "@/stores/catalog-setup-store";
import {
  PREVIEW_STAGING_CARDS,
  PREVIEW_EXISTING_ROWS,
} from "@/lib/catalog-setup/__mocks__/preview-cards";
import type { StepContext } from "@/lib/catalog-setup/step-machine";

const FULL_CONTEXT: StepContext = {
  inventoryTracked: true,
  canSell: true,
  canStock: true,
  canTypes: true,
};

/** Reset the persisted store and reseed it with the foundations mock cards. */
function seedStore() {
  act(() => {
    useCatalogSetupStore.getState().reset();
    useCatalogSetupStore
      .getState()
      .dispatch({ type: "ADD_CARDS", cards: PREVIEW_STAGING_CARDS });
  });
}

beforeEach(() => {
  act(() => useCatalogSetupStore.getState().reset());
});

describe("<SetupWizardShell>", () => {
  it("renders without crashing — the shell, the rail, and both body panes", () => {
    seedStore();
    render(<SetupWizardShell context={FULL_CONTEXT} existingRows={PREVIEW_EXISTING_ROWS} />);

    expect(screen.getByTestId("setup-wizard-shell")).toBeInTheDocument();
    expect(screen.getByTestId("module-rail")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-left-pane")).toBeInTheDocument();
    // Left pane defaults to the driver (no card under edit yet).
    expect(screen.getByTestId("driver-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("item-editor")).toBeNull();
  });

  it("renders the canvas sections from the seeded store", () => {
    seedStore();
    render(<SetupWizardShell context={FULL_CONTEXT} existingRows={PREVIEW_EXISTING_ROWS} />);

    expect(screen.getByTestId("canvas-pane")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-section-sell")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-section-stock")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-section-types")).toBeInTheDocument();
    // Seeded cards surfaced through the real selectors.
    expect(screen.getAllByTestId("staging-card").length).toBeGreaterThan(0);
  });

  it("OMITS the STOCK section + rail segment when inventory is not tracked", () => {
    seedStore();
    render(
      <SetupWizardShell
        context={FULL_CONTEXT}
        inventoryTracked={false}
        existingRows={PREVIEW_EXISTING_ROWS}
      />,
    );

    expect(screen.queryByTestId("canvas-section-stock")).toBeNull();
    expect(screen.queryByTestId("rail-segment-stock")).toBeNull();
    expect(screen.getByTestId("canvas-section-sell")).toBeInTheDocument();
  });

  it("renders the single BUILD IT CTA, enabled when the seed is committable", () => {
    // The default seed has accepted cards and no committable card missing a
    // price/name → nothing blocks the build, so the CTA is enabled.
    seedStore();
    render(<SetupWizardShell context={FULL_CONTEXT} existingRows={PREVIEW_EXISTING_ROWS} />);

    const cta = screen.getByTestId("wizard-build-it");
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveTextContent("BUILD IT");
    expect(cta).not.toBeDisabled();
    // The exit ghost is present alongside it.
    expect(screen.getByTestId("wizard-setup-later")).toBeInTheDocument();
  });

  it("DISABLES BUILD IT with a precise reason when a committable row blocks it", async () => {
    seedStore();
    // Accept the proposed partial-wrap card — it has defaultPrice === null, so
    // once committable it raises the `missing_price` blocker (selectBlockers §16).
    act(() => {
      useCatalogSetupStore
        .getState()
        .dispatch({ type: "ACCEPT_CARD", id: "sell-partial-wrap" });
    });
    render(<SetupWizardShell context={FULL_CONTEXT} existingRows={PREVIEW_EXISTING_ROWS} />);

    const cta = screen.getByTestId("wizard-build-it");
    expect(cta).toBeDisabled();
    const reason = screen.getByTestId("wizard-build-reason");
    // Precise, not generic — names the exact thing to fix.
    expect(reason).toHaveTextContent(/need a price/i);
    expect(reason.textContent).toMatch(/\d/); // carries the count
  });

  it("DISABLES BUILD IT when nothing is accepted yet (empty reason)", () => {
    // Seed nothing committable: a single proposed card, never accepted.
    act(() => {
      useCatalogSetupStore.getState().dispatch({
        type: "ADD_CARDS",
        cards: [PREVIEW_STAGING_CARDS.find((c) => c.id === "sell-gloss-laminate")!],
      });
    });
    render(<SetupWizardShell context={FULL_CONTEXT} />);

    const cta = screen.getByTestId("wizard-build-it");
    expect(cta).toBeDisabled();
    expect(screen.getByTestId("wizard-build-reason")).toHaveTextContent(/accept at least one/i);
  });

  it("fires onBuild when the enabled CTA is clicked", async () => {
    const user = userEvent.setup();
    const onBuild = vi.fn();
    seedStore();
    render(
      <SetupWizardShell
        context={FULL_CONTEXT}
        existingRows={PREVIEW_EXISTING_ROWS}
        onBuild={onBuild}
      />,
    );

    await user.click(screen.getByTestId("wizard-build-it"));
    expect(onBuild).toHaveBeenCalledTimes(1);
  });

  it("swaps the left pane to the ItemEditor when a card's edit is pressed, and back on DONE", async () => {
    const user = userEvent.setup();
    seedStore();
    render(<SetupWizardShell context={FULL_CONTEXT} existingRows={PREVIEW_EXISTING_ROWS} />);

    // Default left pane is the driver.
    expect(screen.getByTestId("driver-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("item-editor")).toBeNull();

    // Click the first card's edit button.
    const firstCard = screen.getAllByTestId("staging-card")[0];
    await user.click(within(firstCard).getByTestId("staging-card-edit"));

    // Left pane swapped to the editor; the driver is gone.
    expect(await screen.findByTestId("item-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("driver-pane")).toBeNull();

    // DONE returns the left pane to the driver.
    await user.click(screen.getByTestId("editor-done"));
    expect(await screen.findByTestId("driver-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("item-editor")).toBeNull();
  });
});
