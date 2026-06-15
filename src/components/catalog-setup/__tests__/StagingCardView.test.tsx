import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Reduced motion ON so the accept stamp / entry snap instantly — deterministic
// render, same end state. (Matches inbox reduced-motion test convention.)
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return { ...actual, useReducedMotion: () => true };
});

// Passthrough `t` — assertions target the English fallback the component passes.
vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    dict: {},
  }),
  useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));

import { StagingCardView, type DiffField } from "../StagingCardView";
import { PREVIEW_CARDS_BY_STATE } from "@/lib/catalog-setup/__mocks__/preview-cards";
import type { StagingCard } from "@/lib/catalog-setup/staging-card";

describe("<StagingCardView>", () => {
  it("renders without crashing and shows the card name + the three actions", () => {
    render(<StagingCardView card={PREVIEW_CARDS_BY_STATE.accepted} />);
    expect(screen.getByText("Full vehicle wrap — cast vinyl")).toBeInTheDocument();
    expect(screen.getByTestId("staging-card-reject")).toBeInTheDocument();
    expect(screen.getByTestId("staging-card-edit")).toBeInTheDocument();
    expect(screen.getByTestId("staging-card-accept")).toBeInTheDocument();
  });

  it("accepted state: olive dot + accept box marked pressed", () => {
    render(<StagingCardView card={PREVIEW_CARDS_BY_STATE.accepted} />);
    const dot = screen.getByTestId("staging-card-dot");
    expect(dot).toHaveClass("bg-olive");
    expect(screen.getByTestId("staging-card-accept")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("staging-card").dataset.dot).toBe("accepted");
  });

  it("proposed SELL with no price: tan needs-review dot", () => {
    // partialWrap has defaultPrice: null → review dot.
    render(<StagingCardView card={PREVIEW_CARDS_BY_STATE.proposed} />);
    expect(screen.getByTestId("staging-card").dataset.dot).toBe("review");
    expect(screen.getByTestId("staging-card-dot")).toHaveClass("bg-tan");
  });

  it("new (fresh, priced) card: hollow dot", () => {
    // A priced proposed material card is fresh → hollow dot.
    const fresh: StagingCard = {
      id: "fresh-1",
      source: "manual",
      state: "proposed",
      module: "sell",
      fields: {
        name: "Spot graphics",
        defaultPrice: 120,
        unitCost: 30,
        isTaxable: true,
        kind: "service",
        type: "LABOR",
      },
    };
    render(<StagingCardView card={fresh} />);
    expect(screen.getByTestId("staging-card").dataset.dot).toBe("new");
    expect(screen.getByTestId("staging-card-dot")).toHaveClass("bg-transparent");
  });

  it("agent-proposed card: lavender provenance + SUGGESTED tag", () => {
    render(<StagingCardView card={PREVIEW_CARDS_BY_STATE.suggested} />);
    const root = screen.getByTestId("staging-card");
    expect(root).toHaveAttribute("data-agent", "true");
    expect(root).toHaveClass("border-agent-border");
    expect(root).toHaveClass("bg-agent-bg");
    const tag = screen.getByTestId("staging-card-source-tag");
    expect(tag).toHaveTextContent("SUGGESTED");
    expect(tag).toHaveClass("text-agent-text");
  });

  it("duplicate (merge) card: tan DUPLICATE tag + struck→olive diff + KEEP/MERGE", () => {
    const diff: DiffField[] = [
      { label: "PRICE", oldValue: "$12", newValue: "$14" },
      { label: "COST", oldValue: "—", newValue: "$6.50" },
    ];
    render(<StagingCardView card={PREVIEW_CARDS_BY_STATE.duplicate} diff={diff} />);
    expect(screen.getByTestId("staging-card")).toHaveAttribute("data-duplicate", "true");
    const dupTag = screen.getByTestId("staging-card-duplicate-tag");
    expect(dupTag).toHaveClass("text-tan");
    // diff: old value struck, new value olive
    const olds = screen.getAllByTestId("diff-old");
    expect(olds[0]).toHaveClass("line-through");
    expect(olds[0]).toHaveClass("text-text-mute");
    expect(screen.getAllByTestId("diff-new")[0]).toHaveClass("text-olive");
    // KEEP / MERGE chips
    expect(screen.getByTestId("staging-card-keep")).toBeInTheDocument();
    expect(screen.getByTestId("staging-card-merge")).toBeInTheDocument();
  });

  it("SELL data row uses earth-tone semantics: COST rose, PRICE text, MARGIN olive", () => {
    render(<StagingCardView card={PREVIEW_CARDS_BY_STATE.accepted} />);
    const row = screen.getByTestId("staging-card-data-row");
    expect(row).toBeInTheDocument();
    // cost $1,150 in rose, price $3,200 in text, margin 64% in olive
    expect(screen.getByText("$1,150")).toHaveClass("text-rose");
    expect(screen.getByText("$3,200")).toHaveClass("text-text");
    expect(screen.getByText("64%")).toHaveClass("text-olive");
  });

  it("STOCK card shows ON HAND / REORDER instead of price/margin", () => {
    render(<StagingCardView card={PREVIEW_CARDS_BY_STATE.stock} />);
    expect(screen.getByText("ON HAND")).toBeInTheDocument();
    expect(screen.getByText("REORDER")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument(); // on-hand
  });

  it("fires onAccept / onReject / onEdit with the card id", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onEdit = vi.fn();
    const card = PREVIEW_CARDS_BY_STATE.proposed;
    render(
      <StagingCardView
        card={card}
        onAccept={onAccept}
        onReject={onReject}
        onEdit={onEdit}
      />,
    );
    fireEvent.click(screen.getByTestId("staging-card-accept"));
    fireEvent.click(screen.getByTestId("staging-card-reject"));
    fireEvent.click(screen.getByTestId("staging-card-edit"));
    expect(onAccept).toHaveBeenCalledWith(card.id);
    expect(onReject).toHaveBeenCalledWith(card.id);
    expect(onEdit).toHaveBeenCalledWith(card.id);
  });

  it("never paints the steel accent on the card (accent reserved for the CTA)", () => {
    const { container } = render(
      <StagingCardView card={PREVIEW_CARDS_BY_STATE.accepted} />,
    );
    expect(container.querySelector('[class*="ops-accent"]')).toBeNull();
  });

  it("renders a trade card by its human label, not the stored slug", () => {
    // A template/agent trade card stores the stable SLUG in `display`; the canvas
    // presents the label (data vs. presentation — OPS design law).
    const tradeCard: StagingCard = {
      id: "tpl_roofing_trade_1",
      module: "types",
      source: "template",
      state: "proposed",
      fields: { display: "roofing", isTrade: true },
    };
    render(<StagingCardView card={tradeCard} />);
    expect(screen.getByText("Roofing")).toBeInTheDocument();
    expect(screen.queryByText("roofing")).toBeNull();
    // the TRADE config chip marks it as the trade, not a task type
    expect(screen.getByTestId("staging-card-config-chip")).toHaveTextContent(
      "TRADE",
    );
  });

  it("falls through to the stored display for a non-slug trade card", () => {
    const tradeCard: StagingCard = {
      id: "tpl_custom_trade_1",
      module: "types",
      source: "agent",
      state: "proposed",
      fields: { display: "Vinyl & graphics", isTrade: true },
    };
    render(<StagingCardView card={tradeCard} />);
    expect(screen.getByText("Vinyl & graphics")).toBeInTheDocument();
  });
});
