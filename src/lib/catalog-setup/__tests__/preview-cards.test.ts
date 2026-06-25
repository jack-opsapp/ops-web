import { describe, expect, it } from "vitest";
import {
  PREVIEW_STAGING_CARDS,
  PREVIEW_EXISTING_ROWS,
  PREVIEW_CARDS_BY_STATE,
  PREVIEW_TOTALS,
} from "@/lib/catalog-setup/__mocks__/preview-cards";
import { COMMITTABLE_STATES } from "@/lib/catalog-setup/staging-card";

describe("preview-cards seed", () => {
  it("covers every downstream state: accepted, proposed, suggested(agent), duplicate(merge), stock", () => {
    expect(PREVIEW_CARDS_BY_STATE.accepted.state).toBe("accepted");
    expect(PREVIEW_CARDS_BY_STATE.proposed.state).toBe("proposed");
    // suggested = agent provenance, surfaced but not yet acted on
    expect(PREVIEW_CARDS_BY_STATE.suggested.source).toBe("agent");
    // duplicate is staged as a merge against a live row
    expect(PREVIEW_CARDS_BY_STATE.duplicate.state).toBe("merge");
    expect(PREVIEW_CARDS_BY_STATE.stock.module).toBe("stock");
  });

  it("stable, unique ids across the seed", () => {
    const ids = PREVIEW_STAGING_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  it("a needs-a-price card exists (null defaultPrice on a SELL row)", () => {
    const needsPrice = PREVIEW_STAGING_CARDS.find(
      (c) => c.module === "sell" && c.fields.defaultPrice === null,
    );
    expect(needsPrice).toBeDefined();
  });

  it("the duplicate card points at a resolvable existing row for the diff", () => {
    const dup = PREVIEW_CARDS_BY_STATE.duplicate;
    expect(dup.matchedExistingId).toBeDefined();
    const existing = PREVIEW_EXISTING_ROWS[dup.matchedExistingId as string];
    expect(existing).toBeDefined();
    // there is a real diff to render (price/cost differ between on-file & incoming)
    if (dup.module === "sell") {
      const incoming = dup.fields;
      expect(incoming.defaultPrice).not.toBe(existing.defaultPrice);
    }
  });

  it("stock cards carry on-hand + reorder point", () => {
    const stockCards = PREVIEW_STAGING_CARDS.filter((c) => c.module === "stock");
    expect(stockCards.length).toBeGreaterThan(0);
    for (const c of stockCards) {
      if (c.module === "stock") {
        expect(typeof c.fields.quantity === "number").toBe(true);
        expect(typeof c.fields.reorderPoint === "number").toBe(true);
      }
    }
  });

  it("precomputed totals match the committable-state count in the seed", () => {
    const committable = PREVIEW_STAGING_CARDS.filter((c) =>
      COMMITTABLE_STATES.includes(c.state),
    ).length;
    expect(PREVIEW_TOTALS.added).toBe(committable);
    expect(PREVIEW_TOTALS.proposed).toBe(
      PREVIEW_STAGING_CARDS.length - committable - PREVIEW_TOTALS.rejected,
    );
  });
});
