import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StateTag } from "../state-tag";

describe("<StateTag>", () => {
  it("renders a YOURS · 18H accent tag with bare variant", () => {
    render(<StateTag tone="accent" variant="bare" prefix="YOURS" value="18H" />);
    const el = screen.getByText("YOURS · 18H");
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass("text-ops-accent");
    expect(el).toHaveClass("font-mono");
    expect(el).toHaveClass("uppercase");
  });

  it("renders a +38D · WAITING rose tag with bare variant", () => {
    render(<StateTag tone="rose" variant="bare" prefix="+38D" value="WAITING" />);
    const el = screen.getByText("+38D · WAITING");
    expect(el).toHaveClass("text-rose");
  });

  it("renders a [HIGH] outline tag", () => {
    render(<StateTag tone="tan" variant="outline" prefix="HIGH" bracketed />);
    const el = screen.getByText("[HIGH]");
    expect(el).toHaveClass("text-tan");
    expect(el).toHaveClass("border");
    expect(el).not.toHaveClass("bg-tan/[0.10]");
  });

  it("renders a DRAFT READY lavender solid tag", () => {
    render(<StateTag tone="lavender" variant="solid" prefix="DRAFT READY" />);
    const el = screen.getByText("DRAFT READY");
    expect(el).toHaveClass("text-agent-hi");
  });

  it("renders an olive bare tag with text-olive", () => {
    render(<StateTag tone="olive" variant="bare" prefix="DONE" />);
    expect(screen.getByText("DONE")).toHaveClass("text-olive");
  });

  it("renders a neutral solid tag with text-text-2 and the correct neutral bg token", () => {
    render(<StateTag tone="neutral" variant="solid" prefix="FYI" bracketed />);
    const el = screen.getByText("[FYI]");
    expect(el).toHaveClass("text-text-2");
    expect(el).toHaveClass("border");
    expect(el).toHaveClass("bg-surface-input");
  });

  it("uses tabular-lining numerals via font-feature-settings", () => {
    render(<StateTag tone="accent" variant="bare" prefix="YOURS" value="18H" />);
    const el = screen.getByText("YOURS · 18H");
    expect(el).toHaveStyle({ fontFeatureSettings: '"tnum" 1, "zero" 1' });
  });
});
