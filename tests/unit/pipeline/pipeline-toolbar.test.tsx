import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineFocusedToolbar } from "@/app/(dashboard)/pipeline/_components/pipeline-focused-toolbar";
import { SpatialFloatingToolbar } from "@/app/(dashboard)/pipeline/_components/spatial-floating-toolbar";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { OpportunityStage } from "@/lib/types/pipeline";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      variants: _variants,
      initial: _initial,
      animate: _animate,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      variants?: unknown;
      initial?: unknown;
      animate?: unknown;
    }) => <div {...props}>{children}</div>,
  },
  useReducedMotion: () => true,
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (key: string) =>
      ({
        "focused.modeButton.spatial": "[ MODE: SPATIAL ▸ ]",
        "focused.modeButton.focused": "[ MODE: FOCUSED ▸ ]",
        "spatial.fitAll": "FIT ALL",
        "spatial.archivedDeals": "ARCHIVE TRAY",
        "spatial.discardedDeals": "DISCARD TRAY",
        "gmail.reviewEmails": "REVIEW EMAILS",
      })[key] ?? key,
  }),
}));

describe("pipeline toolbars", () => {
  beforeEach(() => {
    localStorage.clear();
    usePipelineModeStore.setState({
      mode: "focused",
      focusedStage: OpportunityStage.NewLead,
      detailPanelOpportunityId: null,
      detailPanelActiveTab: "correspondence",
      sortBy: "value",
      stageSortOverrides: new Map(),
    });
  });

  it("renders a monochrome focused toolbar mode toggle", () => {
    render(<PipelineFocusedToolbar />);

    const modeButton = screen.getByRole("button", {
      name: /\[ MODE: SPATIAL ▸ \]/,
    });

    expect(modeButton).toHaveClass("h-[26px]", "bg-transparent", "text-text");
    expect(modeButton).not.toHaveClass("border-line");
    expect(modeButton).not.toHaveClass("bg-surface-active");

    fireEvent.click(modeButton);

    expect(usePipelineModeStore.getState().mode).toBe("spatial");
  });

  it("shows spatial canvas controls only in spatial mode", () => {
    usePipelineModeStore.setState({ mode: "spatial" });

    render(<SpatialFloatingToolbar />);

    expect(
      screen.getByRole("button", { name: /\[ MODE: FOCUSED ▸ \]/ })
    ).toHaveClass("border-ops-accent");
    expect(screen.getByText("FIT ALL")).toBeInTheDocument();
    expect(screen.getByText("ARCHIVE TRAY")).toBeInTheDocument();
    expect(screen.getByText("DISCARD TRAY")).toBeInTheDocument();
  });

  it("hides spatial-only controls when the shared toolbar renders in focused mode", () => {
    render(<SpatialFloatingToolbar />);

    expect(
      screen.getByRole("button", { name: /\[ MODE: SPATIAL ▸ \]/ })
    ).toHaveClass("border-ops-accent");
    expect(screen.queryByText("FIT ALL")).not.toBeInTheDocument();
    expect(screen.queryByText("ARCHIVE TRAY")).not.toBeInTheDocument();
    expect(screen.queryByText("DISCARD TRAY")).not.toBeInTheDocument();
  });
});
