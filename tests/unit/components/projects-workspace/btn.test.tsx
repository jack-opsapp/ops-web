import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Btn } from "@/components/ops/projects/workspace/atoms/btn";

// `Btn` — workspace-scoped button. Diverges from the existing dashboard
// `<Button>` (`src/components/ui/button.tsx`) because the brand spec v2
// mandates **outlined at rest, fills on hover** for primary CTAs, but the
// existing Button keeps `bg-ops-accent` filled at rest for backwards-compat
// with dashboard surfaces. See atom-mapping doc §5.8 for full rationale.

describe("<Btn>", () => {
  it("renders as a button by default", () => {
    render(<Btn>Save</Btn>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("uses font-mohave + uppercase tactical voice", () => {
    render(<Btn>Save</Btn>);
    const el = screen.getByRole("button");
    expect(el).toHaveClass("font-mohave");
    expect(el).toHaveClass("uppercase");
  });

  it("uses the 5px brand btn radius (rounded token)", () => {
    render(<Btn>Save</Btn>);
    expect(screen.getByRole("button")).toHaveClass("rounded");
  });

  it("primary variant is OUTLINED at rest (text-ops-accent + border-ops-accent), no fill", () => {
    render(<Btn variant="primary">Save</Btn>);
    const el = screen.getByRole("button");
    expect(el).toHaveClass("text-ops-accent");
    expect(el).toHaveClass("border-ops-accent");
    expect(el).toHaveClass("bg-transparent");
  });

  it("primary variant fills to bg-ops-accent + black text on hover", () => {
    render(<Btn variant="primary">Save</Btn>);
    const el = screen.getByRole("button");
    expect(el.className).toContain("hover:bg-ops-accent");
    expect(el.className).toContain("hover:text-black");
  });

  it("destructive variant uses rose tone (no brick fill)", () => {
    render(<Btn variant="destructive">Delete</Btn>);
    const el = screen.getByRole("button");
    expect(el).toHaveClass("text-[var(--rose)]");
    expect(el).toHaveClass("border-[var(--rose-line)]");
  });

  it("secondary variant uses neutral hairline border + text-2", () => {
    render(<Btn variant="secondary">Cancel</Btn>);
    const el = screen.getByRole("button");
    expect(el).toHaveClass("text-text-2");
    expect(el).toHaveClass("border-glass-border");
  });

  it("ghost variant has no border, transparent bg, text-2", () => {
    render(<Btn variant="ghost">Skip</Btn>);
    const el = screen.getByRole("button");
    expect(el).toHaveClass("text-text-2");
    expect(el).toHaveClass("bg-transparent");
    expect(el).toHaveClass("border-transparent");
  });

  it.each([
    ["sm", "h-7"],
    ["md", "h-8"],
    ["lg", "h-10"],
  ] as const)("size=%s applies height class %s", (size, expectedClass) => {
    render(<Btn size={size}>X</Btn>);
    expect(screen.getByRole("button")).toHaveClass(expectedClass);
  });

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<Btn onClick={onClick}>Click</Btn>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("respects disabled and stops onClick", async () => {
    const onClick = vi.fn();
    render(
      <Btn onClick={onClick} disabled>
        Click
      </Btn>,
    );
    expect(screen.getByRole("button")).toBeDisabled();
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("uses ease-smooth motion token (no spring/bounce)", () => {
    render(<Btn>Save</Btn>);
    expect(screen.getByRole("button")).toHaveClass("transition-all");
    expect(screen.getByRole("button")).toHaveClass("duration-150");
  });

  it("merges additional className", () => {
    render(<Btn className="w-full">X</Btn>);
    expect(screen.getByRole("button")).toHaveClass("w-full");
    expect(screen.getByRole("button")).toHaveClass("font-mohave");
  });
});
