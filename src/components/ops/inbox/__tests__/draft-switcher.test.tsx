import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  DraftSwitcher,
  type DraftSource,
} from "../composer/draft-switcher";

const sources: { id: DraftSource; label: string }[] = [
  { id: "yours", label: "Yours" },
  { id: "claude", label: "Claude" },
  { id: "gmail", label: "Gmail" },
];

describe("<DraftSwitcher>", () => {
  it("renders the // DRAFTS section label", () => {
    render(
      <DraftSwitcher sources={sources} active={null} onSelect={() => {}} />,
    );
    expect(screen.getByText(/\/\/ DRAFTS/)).toBeInTheDocument();
  });

  it("renders one chip per source", () => {
    render(
      <DraftSwitcher sources={sources} active={null} onSelect={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /Yours/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Claude/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Gmail/i })).toBeInTheDocument();
  });

  it("highlights the active chip with neutral panel surface", () => {
    render(
      <DraftSwitcher sources={sources} active="yours" onSelect={() => {}} />,
    );
    const chip = screen.getByRole("button", { name: /Yours/i });
    expect(chip.className).toMatch(/bg-inbox-panel/);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  it("highlights an active Claude chip with the agent border accent", () => {
    render(
      <DraftSwitcher sources={sources} active="claude" onSelect={() => {}} />,
    );
    const chip = screen.getByRole("button", { name: /Claude/i });
    expect(chip.className).toMatch(/border-agent-border-hi/);
  });

  it("calls onSelect with the source id when a chip is clicked", () => {
    const onSelect = vi.fn();
    render(
      <DraftSwitcher sources={sources} active={null} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Claude/i }));
    expect(onSelect).toHaveBeenCalledWith("claude");
  });

  it("renders nothing when no sources provided", () => {
    const { container } = render(
      <DraftSwitcher sources={[]} active={null} onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
