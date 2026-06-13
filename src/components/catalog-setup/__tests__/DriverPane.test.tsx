import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DriverPane } from "@/components/catalog-setup/DriverPane";

// useDictionary loads its JSON asynchronously (useEffect import), so on first
// render the dict is empty and t(key, fallback) returns the English fallback.
// These tests assert against those fallbacks — no provider needed.

describe("DriverPane", () => {
  it("renders without crashing and shows the // SETUP header", () => {
    render(<DriverPane />);
    expect(screen.getByTestId("driver-pane")).toBeInTheDocument();
    expect(screen.getByText("SETUP")).toBeInTheDocument();
  });

  it("renders the deterministic guided-prompt lead (no faked agent turn)", () => {
    render(<DriverPane />);
    expect(
      screen.getByText(/Tell me what you sell/i),
    ).toBeInTheDocument();
  });

  it("marks the DEFERRED(phase-4) agent seam where SetupAgentPane will mount", () => {
    render(<DriverPane />);
    const seam = screen.getByTestId("driver-agent-seam");
    expect(seam).toBeInTheDocument();
    expect(seam).toHaveAttribute("data-deferred-phase", "4");
    expect(screen.getByText(/guided assistant lands here/i)).toBeInTheDocument();
  });

  it("renders a DISABLED message input (no agent backs it in Phase 1)", () => {
    render(<DriverPane />);
    const input = screen.getByPlaceholderText("Describe what you sell");
    expect(input).toBeDisabled();
  });

  it("renders the send glyph in text-2 (accent stays off non-CTA elements)", () => {
    render(<DriverPane />);
    const send = screen.getByTestId("driver-send");
    expect(send).toHaveClass("text-text-2");
  });

  it("offers the offline → guided-setup escape and fires the handler on click", async () => {
    const onSwitch = vi.fn();
    const user = userEvent.setup();
    render(<DriverPane onSwitchToGuided={onSwitch} />);
    const escape = screen.getByTestId("driver-offline-switch");
    expect(escape).toHaveTextContent("offline? switch to guided setup");
    await user.click(escape);
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it("defaults to the guided-setup conversation (agent + you bubbles)", () => {
    render(<DriverPane />);
    expect(screen.getByTestId("driver-conversation")).toBeInTheDocument();
    // two agent bubbles (opener + reply) frame the single user reply
    expect(screen.getAllByTestId("driver-bubble-agent")).toHaveLength(2);
    expect(screen.getByTestId("driver-bubble-user")).toBeInTheDocument();
    // never the word "AI" — provenance is "guided setup" / "suggested"
    expect(screen.queryByText(/\bAI\b/)).toBeNull();
  });

  it("renders the source picker with all five entry points in picker mode", () => {
    render(<DriverPane mode="picker" />);
    expect(screen.getByTestId("driver-source-picker")).toBeInTheDocument();
    expect(screen.getByText("How do you want to start?")).toBeInTheDocument();
    for (const key of ["quickbooks", "upload", "describe", "template", "manual"]) {
      expect(screen.getByTestId(`driver-source-${key}`)).toBeInTheDocument();
    }
    // the conversation is not shown while picking a source
    expect(screen.queryByTestId("driver-conversation")).toBeNull();
  });

  it("fires onPickSource with the chosen source", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<DriverPane mode="picker" onPickSource={onPick} />);
    await user.click(screen.getByTestId("driver-source-quickbooks"));
    expect(onPick).toHaveBeenCalledWith("quickbooks");
  });
});
