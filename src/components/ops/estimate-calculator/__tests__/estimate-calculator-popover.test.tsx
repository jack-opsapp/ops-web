import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// Mounting a Radix popover and running role queries over a ~25-key keypad costs
// 2.5-5s per test under jsdom, where `getComputedStyle` (which every role query
// calls per element) is slow. That sits right on Vitest's 5s default, so the
// heaviest cases flake. The budget is raised deliberately; `delay: null` on
// userEvent below removes the artificial per-keystroke wait that inflates it.
vi.setConfig({ testTimeout: 20000 });

// `useDictionary` resolves its namespace through an ASYNC dynamic import, so a
// bare render yields raw keys for one tick. Back the hook with the REAL shipped
// English dictionary — the assertions below then pin the actual copy in
// `src/i18n/dictionaries/en/estimate-calculator.json`, not a fixture.
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

import { EstimateCalculatorPopover } from "@/components/ops/estimate-calculator/estimate-calculator-popover";

const QTY_TARGET = { lineItemId: "line-3", field: "quantity" as const, lineNumber: 3 };
const PRICE_TARGET = {
  lineItemId: "line-3",
  field: "unitPrice" as const,
  lineNumber: 3,
};

function renderCalculator(
  overrides: Partial<React.ComponentProps<typeof EstimateCalculatorPopover>> = {},
) {
  const onInsert = vi.fn();
  const utils = render(
    <EstimateCalculatorPopover
      target={QTY_TARGET}
      descriptionSupported={false}
      onInsert={onInsert}
      trigger={<button type="button">CALC</button>}
      {...overrides}
    />,
  );
  return { onInsert, ...utils };
}

async function openCalculator(
  overrides: Partial<React.ComponentProps<typeof EstimateCalculatorPopover>> = {},
) {
  const user = userEvent.setup({ delay: null });
  const rendered = renderCalculator(overrides);
  const trigger = screen.getByRole("button", { name: "CALC" });
  await user.click(trigger);
  const panel = await screen.findByRole("dialog", { name: "Estimate calculator" });
  return { user, trigger, panel, ...rendered };
}

/** Switches mode via the chip radio group. */
async function selectMode(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("radio", { name }));
}

function resultText(): string {
  return screen.getByTestId("calculator-result").textContent ?? "";
}

describe("<EstimateCalculatorPopover> — shell", () => {
  it("opens on trigger click as a labelled dialog", async () => {
    const { panel } = await openCalculator();
    expect(panel).toBeInTheDocument();
  });

  it("renders the panel above windows and dialogs", async () => {
    // Windows sit at z 2000+ and dialogs at 3000; the default popover layer
    // (z-dropdown, 1000) would render the calculator behind its own estimate.
    const { panel } = await openCalculator();
    expect(panel).toHaveClass("z-modal");
  });

  it("bounds its height to the space Radix measured, and scrolls inside", async () => {
    // The panel is taller than the gap between a mid-dialog chip and the
    // viewport edge. Without this it overflowed off-screen — clipped at the
    // top on desktop, past the bottom on mobile — because Radix leaves content
    // overflowing when neither side has room.
    const { panel } = await openCalculator();
    expect(panel.style.maxHeight).toBe(
      "var(--radix-popover-content-available-height)",
    );
    expect(panel).toHaveClass("overflow-y-auto");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const { user, trigger, panel } = await openCalculator();
    await user.keyboard("{Escape}");
    expect(panel).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("<EstimateCalculatorPopover> — CALC mode", () => {
  it("evaluates an expression as it is typed", async () => {
    const { user } = await openCalculator();
    await user.type(screen.getByLabelText("EXPRESSION"), "12*16");
    expect(resultText()).toContain("192");
  });

  it("folds the expression into its result on Enter", async () => {
    const { user } = await openCalculator();
    const field = screen.getByLabelText("EXPRESSION");
    await user.type(field, "12*16{Enter}");
    expect(field).toHaveValue("192");
  });

  it("appends a digit from the keypad", async () => {
    const { user } = await openCalculator();
    await user.type(screen.getByLabelText("EXPRESSION"), "12*1");
    await user.click(screen.getByRole("button", { name: "7" }));
    expect(screen.getByLabelText("EXPRESSION")).toHaveValue("12*17");
  });

  it("deletes the last character with backspace", async () => {
    const { user } = await openCalculator();
    await user.type(screen.getByLabelText("EXPRESSION"), "12*16");
    await user.click(screen.getByRole("button", { name: "Backspace" }));
    expect(screen.getByLabelText("EXPRESSION")).toHaveValue("12*1");
  });

  it("clears the expression", async () => {
    const { user } = await openCalculator();
    await user.type(screen.getByLabelText("EXPRESSION"), "12*16");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByLabelText("EXPRESSION")).toHaveValue("");
  });

  it("reports a malformed expression and disables insert", async () => {
    const { user } = await openCalculator();
    await user.type(screen.getByLabelText("EXPRESSION"), "2++3");
    expect(screen.getByText("[ CHECK THE EXPRESSION ]")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /INSERT/ })).toBeDisabled();
  });

  it("reports division by zero", async () => {
    const { user } = await openCalculator();
    await user.type(screen.getByLabelText("EXPRESSION"), "5/0");
    expect(screen.getByText("[ CANNOT DIVIDE BY ZERO ]")).toBeInTheDocument();
  });

  it("reports a result past the magnitude ceiling", async () => {
    const { user } = await openCalculator();
    await user.type(screen.getByLabelText("EXPRESSION"), "1000000*10000000");
    expect(screen.getByText("[ RESULT TOO LARGE ]")).toBeInTheDocument();
  });

  it("shows the empty state rather than an error before anything is typed", async () => {
    await openCalculator();
    expect(resultText()).toContain("—");
    expect(screen.queryByText("[ CHECK THE EXPRESSION ]")).not.toBeInTheDocument();
  });
});

describe("<EstimateCalculatorPopover> — insert target", () => {
  it("names the quantity field and line it will write to", async () => {
    await openCalculator({ target: QTY_TARGET });
    expect(
      screen.getByRole("button", { name: "INSERT → QTY · LINE 3" }),
    ).toBeInTheDocument();
  });

  it("names the price field and line it will write to", async () => {
    await openCalculator({ target: PRICE_TARGET });
    expect(
      screen.getByRole("button", { name: "INSERT → PRICE · LINE 3" }),
    ).toBeInTheDocument();
  });

  it("is disabled with no target", async () => {
    await openCalculator({ target: null });
    const insert = screen.getByRole("button", {
      name: "[ FOCUS A QTY OR PRICE FIELD ]",
    });
    expect(insert).toBeDisabled();
  });

  it("hands the rounded value to onInsert and closes", async () => {
    const { user, onInsert, panel } = await openCalculator();
    await user.type(screen.getByLabelText("EXPRESSION"), "12*16");
    await user.click(screen.getByRole("button", { name: /INSERT/ }));
    expect(onInsert).toHaveBeenCalledWith({
      value: 192,
      working: null,
      addToDescription: false,
    });
    expect(panel).not.toBeInTheDocument();
  });

  it("inserts on the command-enter shortcut", async () => {
    const { user, onInsert } = await openCalculator();
    await user.type(screen.getByLabelText("EXPRESSION"), "12*16");
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onInsert).toHaveBeenCalledWith({
      value: 192,
      working: null,
      addToDescription: false,
    });
  });

  it("displays a formatted result but inserts the raw rounded number", async () => {
    const { user, onInsert } = await openCalculator();
    await user.type(screen.getByLabelText("EXPRESSION"), "1200.567");
    // Display groups thousands and trims to two decimals…
    expect(resultText()).toContain("1,200.57");
    await user.click(screen.getByRole("button", { name: /INSERT/ }));
    // …while the field receives a plain number, never a formatted string.
    expect(onInsert).toHaveBeenCalledWith({
      value: 1200.57,
      working: null,
      addToDescription: false,
    });
  });
});

describe("<EstimateCalculatorPopover> — AREA mode", () => {
  async function openArea(descriptionSupported = false) {
    const context = await openCalculator({ descriptionSupported });
    await selectMode(context.user, "AREA");
    await context.user.type(screen.getByLabelText("LENGTH"), "12");
    await context.user.type(screen.getByLabelText("WIDTH"), "16");
    return context;
  }

  it("multiplies length by width and shows the working", async () => {
    await openArea();
    expect(resultText()).toContain("192");
    expect(screen.getByText("12 ft × 16 ft = 192 sq ft")).toBeInTheDocument();
  });

  it("re-reports the same area in square metres", async () => {
    const { user } = await openArea();
    await user.click(screen.getByRole("radio", { name: "sq m" }));
    expect(resultText()).toContain("17.84");
    expect(screen.getByText("12 ft × 16 ft = 17.84 sq m")).toBeInTheDocument();
  });

  it("adds waste to the result", async () => {
    const { user } = await openArea();
    await user.type(screen.getByLabelText("WASTE %"), "10");
    expect(resultText()).toContain("211.2");
    expect(
      screen.getByText("12 ft × 16 ft = 192 sq ft (+10% waste = 211.2)"),
    ).toBeInTheDocument();
  });

  it("multiplies by a count of identical areas", async () => {
    const { user } = await openArea();
    await user.type(screen.getByLabelText("COUNT"), "2");
    expect(resultText()).toContain("384");
  });

  it("omits the add-math toggle when the row model has no description", async () => {
    await openArea(false);
    expect(
      screen.queryByRole("checkbox", { name: "[ ADD MATH TO DESCRIPTION ]" }),
    ).not.toBeInTheDocument();
  });

  it("offers the add-math toggle, defaulted on, when a description is supported", async () => {
    await openArea(true);
    expect(
      screen.getByRole("checkbox", { name: "[ ADD MATH TO DESCRIPTION ]" }),
    ).toBeChecked();
  });

  it("passes the working and the add-math intent to onInsert", async () => {
    const { user, onInsert } = await openArea(true);
    await user.click(screen.getByRole("button", { name: /INSERT/ }));
    expect(onInsert).toHaveBeenCalledWith({
      value: 192,
      working: "12 ft × 16 ft = 192 sq ft",
      addToDescription: true,
    });
  });

  it("does not claim add-math when the toggle is turned off", async () => {
    const { user, onInsert } = await openArea(true);
    await user.click(screen.getByRole("checkbox", { name: "[ ADD MATH TO DESCRIPTION ]" }));
    await user.click(screen.getByRole("button", { name: /INSERT/ }));
    expect(onInsert).toHaveBeenCalledWith({
      value: 192,
      working: "12 ft × 16 ft = 192 sq ft",
      addToDescription: false,
    });
  });
});

describe("<EstimateCalculatorPopover> — LINEAR mode", () => {
  async function openLinear() {
    const context = await openCalculator();
    await selectMode(context.user, "LINEAR");
    await context.user.type(screen.getByLabelText("LENGTH 1"), "14");
    await context.user.click(screen.getByRole("button", { name: "ADD LENGTH" }));
    await context.user.type(screen.getByLabelText("LENGTH 2"), "9");
    await context.user.click(screen.getByRole("button", { name: "ADD LENGTH" }));
    await context.user.type(screen.getByLabelText("LENGTH 3"), "22");
    return context;
  }

  it("sums a run of lengths and shows the working", async () => {
    await openLinear();
    expect(resultText()).toContain("45");
    expect(screen.getByText("14 + 9 + 22 ft = 45 lin ft")).toBeInTheDocument();
  });

  it("recomputes when a length is removed", async () => {
    const { user } = await openLinear();
    await user.click(screen.getByRole("button", { name: "Remove length 2" }));
    expect(resultText()).toContain("36");
    expect(screen.getByText("14 + 22 ft = 36 lin ft")).toBeInTheDocument();
  });

  it("adds waste to the run", async () => {
    const { user } = await openLinear();
    await user.type(screen.getByLabelText("WASTE %"), "10");
    expect(resultText()).toContain("49.5");
    expect(
      screen.getByText("14 + 9 + 22 ft = 45 lin ft (+10% waste = 49.5)"),
    ).toBeInTheDocument();
  });
});

describe("<EstimateCalculatorPopover> — CONVERT mode", () => {
  it("converts between units of one dimension", async () => {
    const { user } = await openCalculator();
    await selectMode(user, "CONVERT");
    await user.selectOptions(screen.getByLabelText("FROM"), "m");
    await user.selectOptions(screen.getByLabelText("TO"), "ft");
    await user.type(screen.getByLabelText("VALUE"), "1");
    expect(resultText()).toContain("3.28");
  });

  it("offers only same-dimension units as the conversion target", async () => {
    const { user } = await openCalculator();
    await selectMode(user, "CONVERT");
    await user.selectOptions(screen.getByLabelText("FROM"), "m");
    const options = within(screen.getByLabelText("TO") as HTMLSelectElement)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(["in", "ft", "yd", "cm", "m"]);
  });

  it("keeps the target valid when the source changes dimension", async () => {
    const { user } = await openCalculator();
    await selectMode(user, "CONVERT");
    await user.selectOptions(screen.getByLabelText("FROM"), "sqm");
    const options = within(screen.getByLabelText("TO") as HTMLSelectElement)
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(["sqft", "sqyd", "sqm"]);
  });
});
