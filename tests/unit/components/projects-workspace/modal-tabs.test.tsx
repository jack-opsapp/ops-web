import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ModalTabs } from "@/components/ops/projects/workspace/shell/modal-tabs";

// Phase 12.4 — the active underline uses a shared layoutId so framer-motion
// slides it between tabs. Mock `useReducedMotion` deterministically so the
// reduced-motion path can be asserted.
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    useReducedMotion: vi.fn(() => false),
  };
});

import { useReducedMotion } from "framer-motion";

// `ModalTabs` — workspace tab strip used in viewing-mode dossier
// (Activity / Details / Accounting) and edit/create mode (Identity /
// Schedule). Active tab gets a 1px bottom border in `text-text` colour;
// inactive tabs render text-3 with a transparent border. Tab strip
// background is `--scrim-strip-bg` (rgba(0,0,0,0.18) — consolidated
// from 0.20 per design-token cleanup 2026-05-07; visual delta
// undetectable on glass), bottom border `var(--line)` separates it
// from the body. Mono font, 10.5px, tracking 0.16em uppercase.

const TABS = [
  { id: "activity", label: "Activity" },
  { id: "details", label: "Details" },
  { id: "accounting", label: "Accounting" },
] as const;

describe("<ModalTabs>", () => {
  beforeEach(() => {
    vi.mocked(useReducedMotion).mockReturnValue(false);
  });

  it("renders one tab per option", () => {
    render(<ModalTabs tabs={TABS} activeId="activity" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: /activity/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /details/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /accounting/i })).toBeInTheDocument();
  });

  it("uppercase Mono 10.5px tracking 0.16em", () => {
    render(<ModalTabs tabs={TABS} activeId="activity" onChange={() => {}} />);
    const tab = screen.getByRole("tab", { name: /activity/i });
    expect(tab).toHaveClass("font-mono");
    expect(tab).toHaveClass("uppercase");
    expect(tab.className).toContain("tracking-[0.16em]");
    expect(tab.className).toContain("text-[10.5px]");
  });

  it("active tab uses text-text foreground + renders the shared-layoutId underline", () => {
    render(<ModalTabs tabs={TABS} activeId="activity" onChange={() => {}} />);
    const active = screen.getByRole("tab", { name: /activity/i });
    expect(active).toHaveClass("text-text");
    expect(active).toHaveAttribute("aria-selected", "true");
    // Active tab carries a 1px bg-text underline via a sibling motion.span
    // with shared layoutId — framer-motion slides this element between
    // tabs on selection change.
    const underline = screen.getByTestId("modal-tabs-underline-activity");
    expect(underline).toBeInTheDocument();
    expect(underline.className).toContain("bg-text");
    expect(underline.className).toContain("h-px");
  });

  it("inactive tab uses text-3 + has no underline element", () => {
    render(<ModalTabs tabs={TABS} activeId="activity" onChange={() => {}} />);
    const inactive = screen.getByRole("tab", { name: /details/i });
    expect(inactive).toHaveClass("text-text-3");
    expect(inactive).toHaveAttribute("aria-selected", "false");
    expect(
      screen.queryByTestId("modal-tabs-underline-details"),
    ).not.toBeInTheDocument();
  });

  it("only one underline element exists at a time (single shared instance)", () => {
    const { rerender } = render(
      <ModalTabs tabs={TABS} activeId="activity" onChange={() => {}} />,
    );
    expect(
      document.querySelectorAll('[data-testid^="modal-tabs-underline-"]'),
    ).toHaveLength(1);
    expect(
      screen.getByTestId("modal-tabs-underline-activity"),
    ).toBeInTheDocument();

    rerender(<ModalTabs tabs={TABS} activeId="details" onChange={() => {}} />);
    expect(
      document.querySelectorAll('[data-testid^="modal-tabs-underline-"]'),
    ).toHaveLength(1);
    expect(
      screen.getByTestId("modal-tabs-underline-details"),
    ).toBeInTheDocument();
  });

  it("reduced motion still renders the underline (slide collapses to 0ms)", () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    render(<ModalTabs tabs={TABS} activeId="activity" onChange={() => {}} />);
    expect(
      screen.getByTestId("modal-tabs-underline-activity"),
    ).toBeInTheDocument();
  });

  it("padding 11px 14px", () => {
    render(<ModalTabs tabs={TABS} activeId="activity" onChange={() => {}} />);
    const tab = screen.getByRole("tab", { name: /activity/i });
    expect(tab.className).toContain("px-[14px]");
    expect(tab.className).toContain("py-[11px]");
  });

  it("strip background uses --scrim-strip-bg token and bottom border in glass-border", () => {
    render(<ModalTabs tabs={TABS} activeId="activity" onChange={() => {}} />);
    const tablist = screen.getByRole("tablist");
    expect(tablist.className).toContain("bg-[var(--scrim-strip-bg)]");
    // The plan refers to `var(--line)` — in this codebase the canonical
    // hairline token is `--glass-border` (rgba(255,255,255,0.09)).
    expect(tablist).toHaveClass("border-b");
    expect(tablist).toHaveClass("border-glass-border");
  });

  it("calls onChange with the next tab id when clicked", async () => {
    const onChange = vi.fn();
    render(<ModalTabs tabs={TABS} activeId="activity" onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: /accounting/i }));
    expect(onChange).toHaveBeenCalledWith("accounting");
  });

  it("does not call onChange when clicking the already-active tab (idempotent)", async () => {
    const onChange = vi.fn();
    render(<ModalTabs tabs={TABS} activeId="activity" onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: /activity/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("supports keyboard activation (Enter triggers onChange)", async () => {
    const onChange = vi.fn();
    render(<ModalTabs tabs={TABS} activeId="activity" onChange={onChange} />);
    const target = screen.getByRole("tab", { name: /details/i });
    target.focus();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("details");
  });
});
