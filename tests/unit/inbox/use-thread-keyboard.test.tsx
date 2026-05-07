import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useThreadKeyboard } from "@/components/ops/inbox/use-thread-keyboard";

function Harness({
  onPrev,
  onNext,
  onCommandPalette,
}: {
  onPrev?: () => void;
  onNext?: () => void;
  onCommandPalette?: () => void;
}) {
  useThreadKeyboard({ onPrev, onNext, onCommandPalette });
  return (
    <div>
      <input data-testid="input" />
      <textarea data-testid="textarea" />
    </div>
  );
}

describe("useThreadKeyboard", () => {
  it("J advances next, K retreats prev", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<Harness onPrev={onPrev} onNext={onNext} />);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "K" });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("Cmd+K fires onCommandPalette", () => {
    const onCommandPalette = vi.fn();
    render(<Harness onCommandPalette={onCommandPalette} />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(onCommandPalette).toHaveBeenCalledTimes(1);
  });

  it("does not fire J/K while focused inside an input", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const { getByTestId } = render(<Harness onPrev={onPrev} onNext={onNext} />);
    const input = getByTestId("input") as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: "j" });
    fireEvent.keyDown(input, { key: "k" });
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();
  });

  it("Cmd+K still works inside an input (palette is global)", () => {
    const onCommandPalette = vi.fn();
    const { getByTestId } = render(<Harness onCommandPalette={onCommandPalette} />);
    const input = getByTestId("input") as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: "k", metaKey: true });
    expect(onCommandPalette).toHaveBeenCalledTimes(1);
  });
});
