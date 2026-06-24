import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IconBtn } from "@/components/ops/projects/workspace/atoms/icon-btn";

// `IconBtn` — small square icon-only button. The workspace toolbar / inline
// action voices need a smaller, near-zero-chrome button than the existing
// `<Button size="icon">` (h-7 w-7, with full button chrome). Defaults to
// 28px square (sm). Always requires an `aria-label` for AT.

describe("<IconBtn>", () => {
  it("renders as a button with aria-label", () => {
    render(
      <IconBtn aria-label="Close">
        <svg data-testid="icon" />
      </IconBtn>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("defaults to ghost-style chrome (transparent bg, text-3 icon)", () => {
    render(<IconBtn aria-label="X">x</IconBtn>);
    const el = screen.getByRole("button");
    expect(el).toHaveClass("bg-transparent");
    expect(el).toHaveClass("text-text-3");
  });

  it.each([
    ["xs", "h-6", "w-6"],
    ["sm", "h-7", "w-7"],
    ["md", "h-8", "w-8"],
  ] as const)("size=%s applies %s and %s", (size, h, w) => {
    render(
      <IconBtn aria-label="X" size={size}>
        x
      </IconBtn>,
    );
    const el = screen.getByRole("button");
    expect(el).toHaveClass(h);
    expect(el).toHaveClass(w);
  });

  it("renders with the 5px brand btn radius (rounded token)", () => {
    render(<IconBtn aria-label="X">x</IconBtn>);
    expect(screen.getByRole("button")).toHaveClass("rounded");
  });

  it("destructive variant uses rose hover tint (no brick fill)", () => {
    render(
      <IconBtn aria-label="Delete" variant="destructive">
        x
      </IconBtn>,
    );
    const el = screen.getByRole("button");
    expect(el).toHaveClass("text-[var(--rose)]");
    expect(el.className).toContain("hover:bg-[var(--rose-soft)]");
  });

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    render(
      <IconBtn aria-label="X" onClick={onClick}>
        x
      </IconBtn>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("respects disabled and stops onClick", async () => {
    const onClick = vi.fn();
    render(
      <IconBtn aria-label="X" onClick={onClick} disabled>
        x
      </IconBtn>,
    );
    expect(screen.getByRole("button")).toBeDisabled();
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("merges additional className", () => {
    render(
      <IconBtn aria-label="X" className="ml-2">
        x
      </IconBtn>,
    );
    expect(screen.getByRole("button")).toHaveClass("ml-2");
    expect(screen.getByRole("button")).toHaveClass("rounded");
  });

  it("uses ease-smooth motion (no spring/bounce)", () => {
    render(<IconBtn aria-label="X">x</IconBtn>);
    expect(screen.getByRole("button")).toHaveClass("transition-all");
    expect(screen.getByRole("button")).toHaveClass("duration-150");
  });
});
