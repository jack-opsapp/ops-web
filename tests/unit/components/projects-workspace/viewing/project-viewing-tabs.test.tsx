import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ProjectViewingTabs,
  type ViewingTab,
} from "@/components/ops/projects/workspace/viewing/project-viewing-tabs";

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    useReducedMotion: () => false,
  };
});

const TABS: ReadonlyArray<ViewingTab> = [
  { id: "activity", label: "ACTIVITY" },
  { id: "details", label: "DETAILS" },
  { id: "accounting", label: "ACCOUNTING" },
];

describe("<ProjectViewingTabs>", () => {
  it("renders all tabs with role='tab'", () => {
    render(<ProjectViewingTabs tabs={TABS} activeId="activity" onChange={() => {}} />);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("marks the active tab with aria-selected=true", () => {
    render(<ProjectViewingTabs tabs={TABS} activeId="details" onChange={() => {}} />);
    const detailsTab = screen.getByRole("tab", { name: /details/i });
    expect(detailsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /activity/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("renders the active underline only on the active tab", () => {
    render(<ProjectViewingTabs tabs={TABS} activeId="accounting" onChange={() => {}} />);
    expect(
      screen.getByTestId("project-viewing-tabs-underline-accounting"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("project-viewing-tabs-underline-activity"),
    ).not.toBeInTheDocument();
  });

  it("calls onChange with the clicked tab id", async () => {
    const onChange = vi.fn();
    render(<ProjectViewingTabs tabs={TABS} activeId="activity" onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: /details/i }));
    expect(onChange).toHaveBeenCalledWith("details");
  });

  it("does not call onChange when clicking the already-active tab", async () => {
    const onChange = vi.fn();
    render(<ProjectViewingTabs tabs={TABS} activeId="activity" onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: /activity/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders disabled tabs as cursor-not-allowed and rejects clicks", async () => {
    const onChange = vi.fn();
    const disabledTabs: ReadonlyArray<ViewingTab> = [
      { id: "activity", label: "ACTIVITY" },
      { id: "accounting", label: "ACCOUNTING", disabled: true },
    ];
    render(<ProjectViewingTabs tabs={disabledTabs} activeId="activity" onChange={onChange} />);
    const accounting = screen.getByRole("tab", { name: /accounting/i });
    expect(accounting).toBeDisabled();
    expect(accounting.className).toContain("cursor-not-allowed");
    await userEvent.click(accounting);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses the same layoutId on every active underline so Framer slides between buttons", () => {
    const { rerender } = render(
      <ProjectViewingTabs tabs={TABS} activeId="activity" onChange={() => {}} />,
    );
    const first = screen.getByTestId("project-viewing-tabs-underline-activity");
    expect(first).toBeInTheDocument();
    rerender(<ProjectViewingTabs tabs={TABS} activeId="details" onChange={() => {}} />);
    expect(
      screen.queryByTestId("project-viewing-tabs-underline-activity"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("project-viewing-tabs-underline-details"),
    ).toBeInTheDocument();
  });
});
