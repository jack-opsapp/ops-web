import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  DraftSwitcher,
  type DraftEntry,
} from "../composer/draft-switcher";

const drafts: DraftEntry[] = [
  { id: "d-yours", source: "yours", label: "untitled" },
  { id: "d-claude-1", source: "claude", label: "v1" },
  { id: "d-claude-2", source: "claude", label: "v2 · firmer" },
  { id: "d-gmail", source: "gmail", label: "Apr 19" },
];

describe("<DraftSwitcher>", () => {
  it("renders the Drafts section label", () => {
    render(
      <DraftSwitcher drafts={drafts} activeId={drafts[0].id} onSelect={() => {}} />,
    );
    expect(screen.getByText(/Drafts/)).toBeInTheDocument();
  });

  it("renders one chip per draft, with source label and variant", () => {
    render(
      <DraftSwitcher drafts={drafts} activeId={drafts[0].id} onSelect={() => {}} />,
    );
    expect(screen.getAllByText("Claude")).toHaveLength(2);
    expect(screen.getByText("Yours")).toBeInTheDocument();
    expect(screen.getByText("Gmail")).toBeInTheDocument();
    expect(screen.getByText("untitled")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("highlights the active chip with the panel surface", () => {
    render(
      <DraftSwitcher drafts={drafts} activeId={drafts[0].id} onSelect={() => {}} />,
    );
    const chip = screen.getByRole("button", { name: /Yours/ });
    expect(chip.className).toMatch(/bg-inbox-panel/);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders the index/total counter", () => {
    render(
      <DraftSwitcher drafts={drafts} activeId={drafts[2].id} onSelect={() => {}} />,
    );
    expect(screen.getByText(/3 \/ 4/)).toBeInTheDocument();
  });

  it("calls onSelect with the draft id when a chip is clicked", () => {
    const onSelect = vi.fn();
    render(
      <DraftSwitcher drafts={drafts} activeId={drafts[0].id} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Gmail/ }));
    expect(onSelect).toHaveBeenCalledWith("d-gmail");
  });

  it("renders nothing when no drafts provided", () => {
    const { container } = render(
      <DraftSwitcher drafts={[]} activeId={null} onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("prev/next chevrons disable at the ends and fire callbacks otherwise", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <DraftSwitcher
        drafts={drafts}
        activeId={drafts[0].id}
        onSelect={() => {}}
        onPrev={onPrev}
        onNext={onNext}
      />,
    );
    const prev = screen.getByRole("button", { name: /Previous draft/i });
    const next = screen.getByRole("button", { name: /Next draft/i });
    expect(prev).toBeDisabled();
    expect(next).not.toBeDisabled();
    fireEvent.click(next);
    expect(onNext).toHaveBeenCalled();
  });
});
