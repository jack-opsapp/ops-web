import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HandlerShell } from "@/app/(auth)/auth/action/HandlerShell";

describe("HandlerShell", () => {
  it("renders eyebrow + children", () => {
    render(
      <HandlerShell eyebrow="Test">
        <p>child</p>
      </HandlerShell>,
    );
    expect(screen.getByText(/test/i)).toBeInTheDocument();
    expect(screen.getByText(/child/i)).toBeInTheDocument();
  });

  it("eyebrow uses Cake Mono Light", () => {
    render(<HandlerShell eyebrow="EYE">x</HandlerShell>);
    const el = screen.getByText(/EYE/);
    expect(el.className).toMatch(/font-cakemono|cake-mono/);
    expect(el.className).toMatch(/font-light/);
  });
});
