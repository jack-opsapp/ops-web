import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// Radix plus role queries over the calculator's keypad costs seconds per test
// under jsdom; see the popover's own suite for the same budget.
vi.setConfig({ testTimeout: 20000 });

// The editor batches a stock lookup for every line with a product. It is a
// react-query hook against Supabase — irrelevant to the calculator wiring.
vi.mock("@/lib/hooks/use-stock-indicator", () => ({
  useStockIndicator: () => ({ data: [] }),
}));

// Back the calculator's copy with the REAL shipped dictionary so the insert
// label assertions pin actual product copy.
vi.mock("@/i18n/client", async () => {
  const en = (await import("@/i18n/dictionaries/en/estimate-calculator.json"))
    .default as unknown as Record<string, string>;
  return {
    useDictionary: () => ({
      t: (key: string, fallbackOrParams?: string | Record<string, unknown>) => {
        const value = en[key];
        if (typeof value !== "string") {
          return typeof fallbackOrParams === "string" ? fallbackOrParams : key;
        }
        if (fallbackOrParams && typeof fallbackOrParams === "object") {
          return value.replace(/\{(\w+)\}/g, (match, token) =>
            token in fallbackOrParams ? String(fallbackOrParams[token]) : match,
          );
        }
        return value;
      },
      dict: en,
    }),
    useLocale: () => ({ locale: "en", setLocale: () => {} }),
  };
});

import {
  LineItemEditor,
  createEmptyLineItem,
  type LineItemRow,
} from "@/components/ops/line-item-editor";

function initialItems(): LineItemRow[] {
  return [
    { ...createEmptyLineItem(), id: "line-1", name: "Deck boards", unitPrice: 10 },
    { ...createEmptyLineItem(), id: "line-2", name: "Railing", unitPrice: 20 },
  ];
}

/** The editor is fully controlled, so the test owns the item array. */
function Harness({ onChange }: { onChange: (items: LineItemRow[]) => void }) {
  const [items, setItems] = useState<LineItemRow[]>(initialItems);
  return (
    <LineItemEditor
      items={items}
      onChange={(next) => {
        setItems(next);
        onChange(next);
      }}
    />
  );
}

function renderEditor() {
  const user = userEvent.setup({ delay: null });
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  return { user, onChange };
}

/** Focuses a numeric field, then opens the calculator from the action row. */
async function focusAndOpen(
  user: ReturnType<typeof userEvent.setup>,
  fieldLabel: string,
) {
  const field = screen.getByLabelText(fieldLabel);
  await user.click(field);
  await user.click(screen.getByRole("button", { name: "CALC" }));
  await screen.findByRole("dialog", { name: "Estimate calculator" });
  return field;
}

describe("LineItemEditor — calculator chip", () => {
  it("sits in the action row beside Add Line Item", () => {
    renderEditor();
    const chip = screen.getByRole("button", { name: "CALC" });
    const addButton = screen.getByRole("button", { name: /Add Line Item/ });
    expect(chip.parentElement).toBe(addButton.parentElement);
  });

  it("uses the compact chip tier, not the 64px button size", () => {
    renderEditor();
    const chip = screen.getByRole("button", { name: "CALC" });
    // The project's spacing scale is doubled — `h-8` would be 64px here.
    expect(chip).toHaveClass("h-[28px]");
    expect(chip).toHaveClass("rounded-chip");
    expect(chip).not.toHaveClass("h-8");
  });

  it("puts Add Line Item on the same compact ladder as the chip", () => {
    renderEditor();
    const addButton = screen.getByRole("button", { name: /Add Line Item/ });
    // One height ladder per toolbar row (DESIGN.md §9). The button's own
    // `size="sm"` is `h-8` — 64px on this project's doubled scale.
    expect(addButton).toHaveClass("h-[28px]");
    expect(addButton).not.toHaveClass("h-8");
  });
});

describe("LineItemEditor — insertion target", () => {
  it("names the quantity field of the line that was focused", async () => {
    const { user } = renderEditor();
    await focusAndOpen(user, "Quantity, line 2");
    expect(
      screen.getByRole("button", { name: "INSERT → QTY · LINE 2" }),
    ).toBeInTheDocument();
  });

  it("names the unit price field of the line that was focused", async () => {
    const { user } = renderEditor();
    await focusAndOpen(user, "Unit price, line 1");
    expect(
      screen.getByRole("button", { name: "INSERT → PRICE · LINE 1" }),
    ).toBeInTheDocument();
  });

  it("offers no target until a numeric field has been focused", async () => {
    const { user } = renderEditor();
    await user.click(screen.getByRole("button", { name: "CALC" }));
    await screen.findByRole("dialog", { name: "Estimate calculator" });
    expect(
      screen.getByRole("button", { name: "[ FOCUS A QTY OR PRICE FIELD ]" }),
    ).toBeDisabled();
  });

  it("drops the target when the focused line is removed", async () => {
    const { user } = renderEditor();
    const field = screen.getByLabelText("Quantity, line 2");
    await user.click(field);
    await user.click(screen.getByRole("button", { name: "Remove line 2" }));
    await user.click(screen.getByRole("button", { name: "CALC" }));
    await screen.findByRole("dialog", { name: "Estimate calculator" });
    expect(
      screen.getByRole("button", { name: "[ FOCUS A QTY OR PRICE FIELD ]" }),
    ).toBeDisabled();
  });
});

describe("LineItemEditor — insertion", () => {
  it("writes the finished number through the controlled onChange", async () => {
    const { user, onChange } = renderEditor();
    const field = await focusAndOpen(user, "Quantity, line 2");

    await user.type(screen.getByLabelText("EXPRESSION"), "12*16");
    await user.click(screen.getByRole("button", { name: /INSERT/ }));

    const lastCall = onChange.mock.calls.at(-1)?.[0] as LineItemRow[];
    expect(lastCall.find((item) => item.id === "line-2")?.quantity).toBe(192);
    // Line 1 is untouched.
    expect(lastCall.find((item) => item.id === "line-1")?.quantity).toBe(1);
    // Focus returns to the field the number landed in.
    await waitFor(() => expect(field).toHaveFocus());
  });

  it("writes into the unit price when that was the focused field", async () => {
    const { user, onChange } = renderEditor();
    await focusAndOpen(user, "Unit price, line 1");

    await user.type(screen.getByLabelText("EXPRESSION"), "1200.567");
    await user.click(screen.getByRole("button", { name: /INSERT/ }));

    const lastCall = onChange.mock.calls.at(-1)?.[0] as LineItemRow[];
    expect(lastCall.find((item) => item.id === "line-1")?.unitPrice).toBe(1200.57);
  });

  it("offers no add-math toggle — the row model exposes no description", async () => {
    const { user, onChange } = renderEditor();
    await focusAndOpen(user, "Quantity, line 2");

    await user.click(screen.getByRole("radio", { name: "AREA" }));
    await user.type(screen.getByLabelText("LENGTH"), "12");
    await user.type(screen.getByLabelText("WIDTH"), "16");

    // `LineItemRow` carries no description/notes field and the editor exposes
    // none, so the editor declares descriptionSupported={false} and the toggle
    // never renders. The working is shown, but never written anywhere.
    expect(
      screen.queryByRole("checkbox", { name: "[ ADD MATH TO DESCRIPTION ]" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("12 ft × 16 ft = 192 sq ft")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /INSERT/ }));

    const lastCall = onChange.mock.calls.at(-1)?.[0] as LineItemRow[];
    const line2 = lastCall.find((item) => item.id === "line-2");
    expect(line2?.quantity).toBe(192);
    // Nothing else on the row moved.
    expect(line2?.name).toBe("Railing");
    expect(line2?.unitPrice).toBe(20);
  });
});
