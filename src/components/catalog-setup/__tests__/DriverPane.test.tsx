import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DriverPane } from "@/components/catalog-setup/DriverPane";
import { WIZARD_TRADES } from "@/lib/catalog-setup/trade-list";

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

describe("DriverPane — live agent conversation", () => {
  it("enables the input + submits the description via onSend, then clears", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<DriverPane onSend={onSend} turns={[]} />);
    const input = screen.getByPlaceholderText("Describe what you sell");
    expect(input).toBeEnabled();
    await user.type(input, "I install roofs");
    await user.click(screen.getByTestId("driver-send"));
    expect(onSend).toHaveBeenCalledWith("I install roofs");
    expect(input).toHaveValue("");
  });

  it("renders real owner turns as user bubbles (no preview sample/seam)", () => {
    render(<DriverPane onSend={() => {}} turns={["I'm a plumber"]} />);
    expect(screen.getByText("I'm a plumber")).toBeInTheDocument();
    // live mode drops the phase-4 seam + the canned sample
    expect(screen.queryByTestId("driver-agent-seam")).toBeNull();
    expect(
      screen.queryByText(/Vehicle wraps\. Full wraps/),
    ).toBeNull();
  });

  it("shows the generating turn + disables send while busy", () => {
    render(<DriverPane onSend={() => {}} turns={["roofing"]} busy />);
    expect(screen.getByText(/building your catalog/i)).toBeInTheDocument();
    expect(screen.getByTestId("driver-send")).toBeDisabled();
  });
});

describe("DriverPane — trade picker (TEMPLATE lane)", () => {
  it("renders every wizard trade as a single-select chip in trade-picker mode", () => {
    render(<DriverPane mode="trade-picker" />);
    expect(screen.getByTestId("driver-trade-picker")).toBeInTheDocument();
    expect(screen.getByText("Pick your trade")).toBeInTheDocument();
    for (const trade of WIZARD_TRADES) {
      expect(screen.getByTestId(`driver-trade-${trade.id}`)).toBeInTheDocument();
    }
    // the source picker + conversation are not shown while picking a trade
    expect(screen.queryByTestId("driver-source-picker")).toBeNull();
    expect(screen.queryByTestId("driver-conversation")).toBeNull();
  });

  it("hides the agent input footer in trade-picker mode (self-contained)", () => {
    render(<DriverPane mode="trade-picker" />);
    expect(screen.queryByTestId("driver-send")).toBeNull();
    expect(screen.queryByTestId("driver-offline-switch")).toBeNull();
  });

  it("shows no preview/confirm until a trade is selected", () => {
    render(<DriverPane mode="trade-picker" onPickTrade={() => {}} />);
    expect(screen.queryByTestId("driver-trade-confirm-row")).toBeNull();
    expect(screen.queryByTestId("driver-trade-confirm")).toBeNull();
  });

  it("reveals the count preview + marks the chip pressed on select", async () => {
    const user = userEvent.setup();
    render(<DriverPane mode="trade-picker" onPickTrade={() => {}} />);
    const roofing = screen.getByTestId("driver-trade-roofing");
    expect(roofing).toHaveAttribute("aria-pressed", "false");
    await user.click(roofing);
    expect(roofing).toHaveAttribute("aria-pressed", "true");
    const preview = screen.getByTestId("driver-trade-preview");
    // honest count copy — never "AI"; the digits come from previewTradeTemplate
    expect(preview).toHaveTextContent(/task types/i);
    expect(preview).toHaveTextContent(/starter lines/i);
    expect(preview.textContent ?? "").toMatch(/\d/);
  });

  it("fires onPickTrade with the selected trade on confirm", async () => {
    const onPickTrade = vi.fn();
    const user = userEvent.setup();
    render(<DriverPane mode="trade-picker" onPickTrade={onPickTrade} />);
    await user.click(screen.getByTestId("driver-trade-plumbing"));
    await user.click(screen.getByTestId("driver-trade-confirm"));
    expect(onPickTrade).toHaveBeenCalledWith("plumbing");
  });

  it("returns to the source picker via back (onSwitchToGuided)", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<DriverPane mode="trade-picker" onSwitchToGuided={onBack} />);
    await user.click(screen.getByTestId("driver-trade-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("never says 'AI' in the trade picker", () => {
    render(<DriverPane mode="trade-picker" />);
    expect(screen.queryByText(/\bAI\b/)).toBeNull();
  });
});
