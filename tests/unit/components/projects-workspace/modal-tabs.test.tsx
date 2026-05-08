import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ModalTabs } from "@/components/ops/projects/workspace/shell/modal-tabs";

// `ModalTabs` — workspace tab strip used in viewing-mode dossier
// (Activity / Details / Accounting) and edit/create mode (Identity /
// Schedule). Active tab gets a 1px bottom border in `text-text` colour;
// inactive tabs render text-3 with a transparent border. Tab strip
// background is rgba(0,0,0,0.20) (a darker glass underlay so the active
// underline reads), bottom border `var(--line)` separates it from the
// body. Mono font, 10.5px, tracking 0.16em uppercase.

const TABS = [
  { id: "activity", label: "Activity" },
  { id: "details", label: "Details" },
  { id: "accounting", label: "Accounting" },
] as const;

describe("<ModalTabs>", () => {
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

  it("active tab uses text-text + bottom border in text-text", () => {
    render(<ModalTabs tabs={TABS} activeId="activity" onChange={() => {}} />);
    const active = screen.getByRole("tab", { name: /activity/i });
    expect(active).toHaveClass("text-text");
    // Active underline — 1px bottom border in --text. Bracket notation
    // because there's no Tailwind named `border-b-text` token.
    expect(active.className).toContain("border-b-[var(--text)]");
    expect(active).toHaveAttribute("aria-selected", "true");
  });

  it("inactive tab uses text-3 + transparent bottom border", () => {
    render(<ModalTabs tabs={TABS} activeId="activity" onChange={() => {}} />);
    const inactive = screen.getByRole("tab", { name: /details/i });
    expect(inactive).toHaveClass("text-text-3");
    expect(inactive).toHaveAttribute("aria-selected", "false");
    expect(inactive.className).toContain("border-b-transparent");
  });

  it("padding 11px 14px", () => {
    render(<ModalTabs tabs={TABS} activeId="activity" onChange={() => {}} />);
    const tab = screen.getByRole("tab", { name: /activity/i });
    expect(tab.className).toContain("px-[14px]");
    expect(tab.className).toContain("py-[11px]");
  });

  it("strip background uses rgba(0,0,0,0.20) and bottom border in glass-border", () => {
    render(<ModalTabs tabs={TABS} activeId="activity" onChange={() => {}} />);
    const tablist = screen.getByRole("tablist");
    expect(tablist.className).toContain("bg-[rgba(0,0,0,0.20)]");
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
