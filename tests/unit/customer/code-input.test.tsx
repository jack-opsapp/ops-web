import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { CodeInput } from "@/components/customer/code-input";

function Harness({
  onComplete,
  disabled = false,
}: {
  onComplete?: (code: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <CodeInput
      value={value}
      onChange={setValue}
      onComplete={onComplete}
      disabled={disabled}
      label="Six-digit code"
      digitLabel={(n) => `Digit ${n} of 6`}
      autoFocus
    />
  );
}

function cells(): HTMLInputElement[] {
  return Array.from({ length: 6 }, (_, i) =>
    screen.getByLabelText(`Digit ${i + 1} of 6`)
  ) as HTMLInputElement[];
}

describe("CodeInput", () => {
  it("renders six numeric cells, the first wired for one-time-code autofill", () => {
    render(<Harness />);
    const inputs = cells();
    expect(inputs).toHaveLength(6);
    expect(inputs[0]).toHaveAttribute("autocomplete", "one-time-code");
    expect(inputs[1]).toHaveAttribute("autocomplete", "off");
    for (const input of inputs) {
      expect(input).toHaveAttribute("inputmode", "numeric");
    }
    expect(screen.getByRole("group", { name: "Six-digit code" })).toBeInTheDocument();
  });

  it("advances on each digit and fires onComplete once when the sixth lands", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    const inputs = cells();
    expect(inputs[0]).toHaveFocus();

    await user.keyboard("123456");

    expect(inputs.map((i) => i.value).join("")).toBe("123456");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("ignores non-digits", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard("a1b2");
    expect(cells().map((i) => i.value).join("")).toBe("12");
  });

  it("backspace on an empty cell steps back and clears the previous digit", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const inputs = cells();
    await user.keyboard("12");
    expect(inputs[2]).toHaveFocus();
    await user.keyboard("{Backspace}");
    expect(inputs[1]).toHaveFocus();
    expect(inputs.map((i) => i.value).join("")).toBe("1");
  });

  it("distributes a pasted code from the first cell", async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    const inputs = cells();
    inputs[3].focus();
    fireEvent.paste(inputs[3], {
      clipboardData: { getData: () => "Your code: 98 76 54" },
    });
    expect(inputs.map((i) => i.value).join("")).toBe("987654");
    expect(onComplete).toHaveBeenCalledWith("987654");
  });

  it("distributes an autofilled six-digit value typed into the first cell", () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    const inputs = cells();
    fireEvent.change(inputs[0], { target: { value: "246810" } });
    expect(inputs.map((i) => i.value).join("")).toBe("246810");
    expect(onComplete).toHaveBeenCalledWith("246810");
  });

  it("arrow keys move between cells", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const inputs = cells();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(inputs[2]).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(inputs[1]).toHaveFocus();
  });

  it("does nothing while disabled", async () => {
    const user = userEvent.setup();
    render(<Harness disabled />);
    const inputs = cells();
    for (const input of inputs) expect(input).toBeDisabled();
    await user.keyboard("1");
    expect(inputs.map((i) => i.value).join("")).toBe("");
  });
});
