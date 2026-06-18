import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PrerequisiteGate, GatePanel } from "../prerequisite-gate";

describe("PrerequisiteGate", () => {
  it("renders children when there is no blocker", () => {
    render(
      <PrerequisiteGate blocker={null}>
        <div>WIZARD</div>
      </PrerequisiteGate>,
    );
    expect(screen.getByText("WIZARD")).toBeInTheDocument();
  });

  it("renders the catalog-surface reason instead of children", () => {
    render(
      <PrerequisiteGate blocker="catalog_surface_absent">
        <div>WIZARD</div>
      </PrerequisiteGate>,
    );
    expect(screen.queryByText("WIZARD")).not.toBeInTheDocument();
    expect(screen.getByText(/catalog offline/i)).toBeInTheDocument();
  });

  it("shows the subscription-lockout reason", () => {
    render(
      <PrerequisiteGate blocker="subscription_locked">
        <div>WIZARD</div>
      </PrerequisiteGate>,
    );
    expect(screen.queryByText("WIZARD")).not.toBeInTheDocument();
    expect(screen.getByText(/plan needs attention/i)).toBeInTheDocument();
  });

  it("shows the no-company reason", () => {
    render(
      <PrerequisiteGate blocker="no_company">
        <div>WIZARD</div>
      </PrerequisiteGate>,
    );
    expect(screen.getByText(/no company yet/i)).toBeInTheDocument();
  });

  it("shows the baseline-not-seeded reason", () => {
    render(
      <PrerequisiteGate blocker="baseline_not_seeded">
        <div>WIZARD</div>
      </PrerequisiteGate>,
    );
    expect(screen.getByText(/almost ready/i)).toBeInTheDocument();
  });
});

describe("GatePanel", () => {
  it("renders the session-locked reason as a calm panel, never a crash", () => {
    render(<GatePanel reason="session_locked" />);
    expect(screen.getByText(/already in setup/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing's lost/i)).toBeInTheDocument();
  });

  it("sits on glass and uses no accent (accent is BUILD IT only)", () => {
    render(<GatePanel reason="baseline_not_seeded" />);
    const panel = screen.getByTestId("catalog-setup-gate");
    expect(panel.className).toMatch(/glass-surface/);
    expect(panel.className).not.toMatch(/ops-accent/);
  });

  it("offers a reload affordance for a transient reason and fires it", () => {
    const onReload = vi.fn();
    render(<GatePanel reason="session_locked" onReload={onReload} />);
    fireEvent.click(screen.getByRole("button", { name: /reload/i }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("does NOT offer reload for a reason a reload can't clear (no_company)", () => {
    const onReload = vi.fn();
    render(<GatePanel reason="no_company" onReload={onReload} />);
    expect(
      screen.queryByRole("button", { name: /reload/i }),
    ).not.toBeInTheDocument();
  });

  it("fires the exit affordance when offered", () => {
    const onExit = vi.fn();
    render(<GatePanel reason="subscription_locked" onExit={onExit} />);
    fireEvent.click(screen.getByRole("button", { name: /back to catalog/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  // Accessibility — the panel REPLACES the wizard, so it is the page's primary
  // content when shown (the wizard's own h1 never mounts in this state).
  it("titles the panel as the page's primary heading (h1)", () => {
    render(<GatePanel reason="catalog_surface_absent" />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/catalog offline/i);
  });

  it("is a labelled region that receives focus on mount (keyboard/SR land on it)", () => {
    render(<GatePanel reason="session_locked" />);
    const region = screen.getByRole("region", { name: /already in setup/i });
    expect(region).toBeInTheDocument();
    expect(region).toHaveFocus();
  });
});
