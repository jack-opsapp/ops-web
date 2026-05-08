import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TrafficLight } from "@/components/ops/projects/workspace/shell/traffic-light";

// `TrafficLight` — Mac-style window control. At rest it reads as a
// monochrome 11×11 dot (white-alpha bg, white-alpha border) so the chrome
// reads quiet; on hover it tints to the canonical macOS hue (close=red,
// minimize=yellow, maximize=green) and the glyph reveals. The tone is
// monochrome AT REST (per design spec) — the chrome should not look like
// a traffic light until the user hovers it.

describe("<TrafficLight>", () => {
  it("renders as a button (a11y target)", () => {
    render(<TrafficLight tone="close" onClick={() => {}} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("close exposes accessible name 'Close'", () => {
    render(<TrafficLight tone="close" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("minimize exposes accessible name 'Minimize'", () => {
    render(<TrafficLight tone="minimize" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: /minimize/i })).toBeInTheDocument();
  });

  it("maximize exposes accessible name 'Maximize'", () => {
    render(<TrafficLight tone="maximize" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: /maximize/i })).toBeInTheDocument();
  });

  it("is 11x11 with full radius (round dot)", () => {
    render(<TrafficLight tone="close" onClick={() => {}} />);
    const el = screen.getByRole("button");
    expect(el).toHaveClass("w-[11px]");
    expect(el).toHaveClass("h-[11px]");
    expect(el).toHaveClass("rounded-full");
  });

  it("monochrome at rest — bg and border are white-alpha tokens, not the tone hue", () => {
    render(<TrafficLight tone="close" onClick={() => {}} />);
    const el = screen.getByRole("button");
    // bg-[rgba(255,255,255,0.18)] (rest) — explicitly NOT the close red
    expect(el.className).toContain("bg-[rgba(255,255,255,0.18)]");
  });

  it("tints to its tone hue on hover (close=var(--macos-traffic-close))", () => {
    render(<TrafficLight tone="close" onClick={() => {}} />);
    expect(screen.getByRole("button").className).toContain(
      "hover:bg-[var(--macos-traffic-close)]",
    );
  });

  it("tints to its tone hue on hover (minimize=var(--macos-traffic-minimize))", () => {
    render(<TrafficLight tone="minimize" onClick={() => {}} />);
    expect(screen.getByRole("button").className).toContain(
      "hover:bg-[var(--macos-traffic-minimize)]",
    );
  });

  it("tints to its tone hue on hover (maximize=var(--macos-traffic-maximize))", () => {
    render(<TrafficLight tone="maximize" onClick={() => {}} />);
    expect(screen.getByRole("button").className).toContain(
      "hover:bg-[var(--macos-traffic-maximize)]",
    );
  });

  it("uses 120ms transition (per design spec)", () => {
    render(<TrafficLight tone="close" onClick={() => {}} />);
    const el = screen.getByRole("button");
    expect(el).toHaveClass("transition-colors");
    expect(el).toHaveClass("duration-[120ms]");
  });

  it("calls onClick when activated", async () => {
    const onClick = vi.fn();
    render(<TrafficLight tone="close" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("includes a glyph SVG that is hidden at rest and visible on hover", () => {
    const { container } = render(<TrafficLight tone="close" onClick={() => {}} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // Glyph layer is opacity-0 by default and opacity-100 on hover —
    // matches the macOS reveal pattern. Group-hover so hovering the
    // button (not just the SVG itself) triggers reveal.
    expect(svg!.getAttribute("class")).toContain("opacity-0");
    expect(svg!.getAttribute("class")).toContain("group-hover:opacity-100");
  });
});
