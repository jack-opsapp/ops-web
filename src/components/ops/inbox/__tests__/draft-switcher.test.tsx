import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  DraftSwitcher,
  type DraftEntry,
} from "../composer/draft-switcher";

const drafts: DraftEntry[] = [
  { id: "d-gmail", source: "gmail", label: "Apr 19" },
  { id: "d-claude-1", source: "claude", label: "v1" },
  { id: "d-yours", source: "yours", label: "untitled" },
];

describe("<DraftSwitcher>", () => {
  it("renders nothing when 0 drafts", () => {
    const { container } = render(
      <DraftSwitcher drafts={[]} activeId={null} onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when 1 draft", () => {
    const { container } = render(
      <DraftSwitcher
        drafts={[{ id: "d-only", source: "gmail" }]}
        activeId="d-only"
        onSelect={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders 2+ drafts as tabs with sequential 1-based ordinals", () => {
    render(
      <DraftSwitcher
        drafts={drafts}
        activeId={drafts[0].id}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /1 · GMAIL/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2 · CLAUDE/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /3 · YOURS/ })).toBeInTheDocument();
  });

  it("does not render the unicode ✦ glyph for the Claude tab", () => {
    render(
      <DraftSwitcher
        drafts={drafts}
        activeId={drafts[0].id}
        onSelect={() => {}}
      />,
    );
    const claudeTab = screen.getByRole("button", { name: /CLAUDE/ });
    // Tab text should be "2 · CLAUDE", not "✦ 2 · CLAUDE".
    expect(claudeTab.textContent).not.toMatch(/✦/);
    expect(claudeTab.textContent).toMatch(/2 · CLAUDE/);
  });

  it("renders a Lucide Sparkles icon prefix on the Claude tab only", () => {
    const { container } = render(
      <DraftSwitcher
        drafts={drafts}
        activeId={drafts[0].id}
        onSelect={() => {}}
      />,
    );
    const claudeTab = screen.getByRole("button", { name: /CLAUDE/ });
    const gmailTab = screen.getByRole("button", { name: /GMAIL/ });
    const yoursTab = screen.getByRole("button", { name: /YOURS/ });
    expect(claudeTab.querySelector("svg.lucide-sparkles")).toBeTruthy();
    expect(gmailTab.querySelector("svg.lucide-sparkles")).toBeNull();
    expect(yoursTab.querySelector("svg.lucide-sparkles")).toBeNull();
    // Sanity: there is exactly one Sparkles svg in the entire switcher.
    expect(container.querySelectorAll("svg.lucide-sparkles")).toHaveLength(1);
  });

  it("the Sparkles icon stays text-agent regardless of active state", () => {
    const { rerender } = render(
      <DraftSwitcher
        drafts={drafts}
        activeId={drafts[0].id}
        onSelect={() => {}}
      />,
    );
    const inactiveSparkles = screen
      .getByRole("button", { name: /CLAUDE/ })
      .querySelector("svg.lucide-sparkles");
    expect(inactiveSparkles?.getAttribute("class") ?? "").toMatch(/text-agent/);

    rerender(
      <DraftSwitcher
        drafts={drafts}
        activeId={drafts[1].id}
        onSelect={() => {}}
      />,
    );
    const activeSparkles = screen
      .getByRole("button", { name: /CLAUDE/ })
      .querySelector("svg.lucide-sparkles");
    expect(activeSparkles?.getAttribute("class") ?? "").toMatch(/text-agent/);
  });

  it("active tab uses text-text + 1.5px bottom border with accent for human source", () => {
    render(
      <DraftSwitcher
        drafts={drafts}
        activeId={drafts[0].id}
        onSelect={() => {}}
      />,
    );
    const gmailTab = screen.getByRole("button", { name: /GMAIL/ });
    expect(gmailTab.getAttribute("aria-pressed")).toBe("true");
    expect(gmailTab.className).toMatch(/text-text\b/);
    expect(gmailTab.className).toMatch(/border-b-\[1\.5px\]/);
    expect(gmailTab.className).toMatch(/border-ops-accent/);
  });

  it("active tab uses agent border for Claude source", () => {
    render(
      <DraftSwitcher
        drafts={drafts}
        activeId={drafts[1].id}
        onSelect={() => {}}
      />,
    );
    const claudeTab = screen.getByRole("button", { name: /CLAUDE/ });
    expect(claudeTab.getAttribute("aria-pressed")).toBe("true");
    expect(claudeTab.className).toMatch(/border-agent/);
    expect(claudeTab.className).not.toMatch(/border-ops-accent/);
  });

  it("active tab uses accent border for new and yours sources", () => {
    const newDrafts: DraftEntry[] = [
      { id: "a", source: "yours" },
      { id: "b", source: "new" },
    ];
    const { rerender } = render(
      <DraftSwitcher
        drafts={newDrafts}
        activeId="a"
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /YOURS/ }).className,
    ).toMatch(/border-ops-accent/);

    rerender(
      <DraftSwitcher
        drafts={newDrafts}
        activeId="b"
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /NEW/ }).className,
    ).toMatch(/border-ops-accent/);
  });

  it("inactive tab uses text-text-3", () => {
    render(
      <DraftSwitcher
        drafts={drafts}
        activeId={drafts[0].id}
        onSelect={() => {}}
      />,
    );
    const claudeTab = screen.getByRole("button", { name: /CLAUDE/ });
    expect(claudeTab.getAttribute("aria-pressed")).toBe("false");
    expect(claudeTab.className).toMatch(/text-text-3/);
  });

  it("calls onSelect with the draft id when a tab is clicked", () => {
    const onSelect = vi.fn();
    render(
      <DraftSwitcher
        drafts={drafts}
        activeId={drafts[0].id}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /CLAUDE/ }));
    expect(onSelect).toHaveBeenCalledWith("d-claude-1");
  });

  it("renders the [+] add-new button when onAdd is provided", () => {
    render(
      <DraftSwitcher
        drafts={drafts}
        activeId={drafts[0].id}
        onSelect={() => {}}
        onAdd={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Add new draft/i }),
    ).toBeInTheDocument();
  });

  it("hides the [+] add-new button when onAdd is not provided", () => {
    render(
      <DraftSwitcher
        drafts={drafts}
        activeId={drafts[0].id}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Add new draft/i }),
    ).toBeNull();
  });

  it("calls onAdd when the [+] button is clicked", () => {
    const onAdd = vi.fn();
    render(
      <DraftSwitcher
        drafts={drafts}
        activeId={drafts[0].id}
        onSelect={() => {}}
        onAdd={onAdd}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add new draft/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
