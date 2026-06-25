import { describe, it, expect, beforeEach } from "vitest";
import { useCatalogSetupStore } from "@/stores/catalog-setup-store";
import type { StagingCard } from "@/lib/catalog-setup/staging-card";

function sell(id: string): StagingCard {
  return {
    id,
    source: "manual",
    state: "proposed",
    module: "sell",
    fields: {
      name: id,
      defaultPrice: 10,
      unitCost: 0,
      isTaxable: true,
      kind: "service",
      type: "LABOR",
    },
  };
}

describe("useCatalogSetupStore", () => {
  beforeEach(() => useCatalogSetupStore.getState().reset());

  it("starts with an empty canvas and step 'sell'", () => {
    expect(useCatalogSetupStore.getState().cards).toEqual([]);
    expect(useCatalogSetupStore.getState().currentStep).toBe("sell");
  });

  it("dispatch ADD_CARDS then ACCEPT_CARD mutates through the reducer", () => {
    const d = useCatalogSetupStore.getState().dispatch;
    d({ type: "ADD_CARDS", cards: [sell("a")] });
    d({ type: "ACCEPT_CARD", id: "a" });
    expect(useCatalogSetupStore.getState().cards[0].state).toBe("accepted");
  });

  it("dispatch is reducer-backed: idempotent ADD does not duplicate", () => {
    const d = useCatalogSetupStore.getState().dispatch;
    d({ type: "ADD_CARDS", cards: [sell("a")] });
    d({ type: "ADD_CARDS", cards: [sell("a")] });
    expect(useCatalogSetupStore.getState().cards).toHaveLength(1);
  });

  it("setStep updates the current step", () => {
    useCatalogSetupStore.getState().setStep("types");
    expect(useCatalogSetupStore.getState().currentStep).toBe("types");
  });

  it("reset clears cards and returns to step 'sell'", () => {
    const d = useCatalogSetupStore.getState().dispatch;
    d({ type: "ADD_CARDS", cards: [sell("a")] });
    useCatalogSetupStore.getState().setStep("review");
    useCatalogSetupStore.getState().reset();
    expect(useCatalogSetupStore.getState().cards).toEqual([]);
    expect(useCatalogSetupStore.getState().currentStep).toBe("sell");
  });

  it("RESET dispatched through the reducer also clears the canvas", () => {
    const d = useCatalogSetupStore.getState().dispatch;
    d({ type: "ADD_CARDS", cards: [sell("a"), sell("b")] });
    d({ type: "RESET" });
    expect(useCatalogSetupStore.getState().cards).toEqual([]);
  });

  it("exposes a _hydrated flag", () => {
    expect(typeof useCatalogSetupStore.getState()._hydrated).toBe("boolean");
  });

  it("persists the canvas under the dedicated key", () => {
    const d = useCatalogSetupStore.getState().dispatch;
    d({ type: "ADD_CARDS", cards: [sell("a")] });
    const raw = window.localStorage.getItem("ops-catalog-setup-state");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.cards.map((c: StagingCard) => c.id)).toEqual(["a"]);
  });
});
