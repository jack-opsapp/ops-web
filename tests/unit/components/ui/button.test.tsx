import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Button } from "@/components/ui/button";

// The shared dashboard `<Button>`. DESIGN.md §9 / spec v2 pin the primary CTA
// to OUTLINED at rest (`text-ops-accent border-ops-accent`, transparent fill)
// that fills to `bg-ops-accent text-black` on hover — accent is a quiet
// promise, not a shout. These assertions keep the shared variant on spec so
// the fifty-odd `variant="primary"` call sites can't drift back to a filled
// rest state.

describe("<Button>", () => {
  it("primary variant is OUTLINED at rest (accent text + accent hairline, no fill)", () => {
    render(<Button variant="primary">Save</Button>);
    const el = screen.getByRole("button", { name: "Save" });
    expect(el).toHaveClass("bg-transparent");
    expect(el).toHaveClass("text-ops-accent");
    expect(el).toHaveClass("border-ops-accent");
    expect(el.className).not.toMatch(/(^|\s)bg-ops-accent(\s|$)/);
    expect(el.className).not.toMatch(/(^|\s)text-black(\s|$)/);
  });

  it("primary variant fills to bg-ops-accent + black text on hover", () => {
    render(<Button variant="primary">Save</Button>);
    const el = screen.getByRole("button", { name: "Save" });
    expect(el.className).toContain("hover:bg-ops-accent");
    expect(el.className).toContain("hover:text-black");
  });

  it("keeps the 14px Cake Mono 300 label at every size (cn() must not drop the size token)", () => {
    render(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="default" size="sm">
          Small
        </Button>
        <Button variant="secondary" size="lg">
          Large
        </Button>
      </>,
    );
    for (const name of ["Primary", "Small", "Large"]) {
      const el = screen.getByRole("button", { name });
      expect(el).toHaveClass("font-cakemono");
      expect(el).toHaveClass("font-light");
      expect(el).toHaveClass("text-cake-button");
      expect(el).toHaveClass("uppercase");
    }
  });

  it("uses the 5px brand btn radius (bare `rounded`), the 36px standard height and 16px side padding", () => {
    render(<Button variant="primary">Save</Button>);
    const el = screen.getByRole("button", { name: "Save" });
    expect(el).toHaveClass("rounded");
    // OPS overrides Tailwind's numeric spacing scale (`h-9`/`px-4` do not mean
    // 36px/16px here), so the ladder must use the explicit control tokens.
    expect(el).toHaveClass("h-control-36");
    expect(el).toHaveClass("px-2");
    expect(el.className).not.toMatch(/(^|\s)h-(8|9|10)(\s|$)/);
  });

  it("compact and large sizes sit on the 32 / 40px control ladder (never the 64px `h-8`)", () => {
    render(
      <>
        <Button variant="primary" size="sm">
          Small
        </Button>
        <Button variant="primary" size="lg">
          Large
        </Button>
        <Button variant="primary" size="icon" aria-label="Icon" />
      </>,
    );
    expect(screen.getByRole("button", { name: "Small" })).toHaveClass("h-control-32");
    expect(screen.getByRole("button", { name: "Large" })).toHaveClass("h-control-40");
    const icon = screen.getByRole("button", { name: "Icon" });
    expect(icon).toHaveClass("h-control-36");
    expect(icon).toHaveClass("w-control-36");
  });

  it("default variant stays neutral glass (no accent)", () => {
    render(<Button>Neutral</Button>);
    const el = screen.getByRole("button", { name: "Neutral" });
    expect(el).toHaveClass("text-text-2");
    // Accent is reserved for the primary CTA and the focus ring — the ring is
    // the one accent class every variant carries.
    expect(el.className).not.toMatch(/(^|\s)(bg|text|border)-ops-accent/);
  });

  it("loading state disables the button and announces busy", () => {
    render(
      <Button variant="primary" loading>
        Save
      </Button>,
    );
    const el = screen.getByRole("button");
    expect(el).toBeDisabled();
    expect(el).toHaveAttribute("aria-busy", "true");
  });
});
