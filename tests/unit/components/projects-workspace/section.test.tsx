import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Section } from "@/components/ops/projects/workspace/atoms/section";

// `Section` — `// TITLE` slash-prefix header + dashed hairline. Standardises
// the workspace's section-title voice so callers stop hand-rolling the
// `<Mono>// X</Mono><Hairline variant="dashed" />` pair.

describe("<Section>", () => {
  it("renders the title with a // slash prefix", () => {
    render(<Section title="OVERVIEW" />);
    // Slashes are dimmed via text-mute; title body uses Mono text-3.
    expect(screen.getByText("//", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("OVERVIEW")).toBeInTheDocument();
  });

  it("renders title via Mono (font-mono uppercase)", () => {
    render(<Section title="OVERVIEW" />);
    const titleEl = screen.getByText("OVERVIEW");
    expect(titleEl).toHaveClass("font-mono");
    expect(titleEl).toHaveClass("uppercase");
  });

  it("dims the // slashes (text-mute) so the title reads as the focal point", () => {
    render(<Section title="OVERVIEW" />);
    // The slashes are wrapped in their own Mono with mute color
    const slashEl = screen.getAllByText(/^\/\/$/)[0];
    expect(slashEl).toHaveClass("text-text-mute");
  });

  it("renders a dashed hairline below the title", () => {
    render(<Section title="OVERVIEW" data-testid="section" />);
    const hairline = screen.getByRole("separator");
    expect(hairline).toHaveClass("border-dashed");
    expect(hairline).toHaveClass("border-glass-border");
  });

  it("renders children below the hairline", () => {
    render(
      <Section title="OVERVIEW">
        <span data-testid="child">body</span>
      </Section>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders an optional right slot in the title row", () => {
    render(
      <Section
        title="OVERVIEW"
        rightSlot={<span data-testid="right">EDIT</span>}
      />,
    );
    expect(screen.getByTestId("right")).toBeInTheDocument();
  });

  it("merges additional className onto the wrapper", () => {
    render(<Section title="X" data-testid="section" className="mt-3" />);
    expect(screen.getByTestId("section")).toHaveClass("mt-3");
  });
});
