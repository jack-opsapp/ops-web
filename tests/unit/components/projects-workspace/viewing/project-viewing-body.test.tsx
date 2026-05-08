import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectStatus } from "@/lib/types/models";

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return { ...actual, useReducedMotion: () => false };
});

const mockProject = vi.fn();
const mockCan = vi.fn();

vi.mock("@/lib/hooks/use-projects", () => ({
  useProject: () => mockProject(),
}));
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (
    selector: (s: { can: (p: string) => boolean }) => unknown,
  ) => selector({ can: mockCan }),
}));

// Stub the heavy children — we're testing the orchestrator, not the children.
vi.mock("@/components/ops/projects/workspace/map/map-hero", () => ({
  MapHero: ({ expanded, onToggleExpand }: { expanded: boolean; onToggleExpand: () => void }) => (
    <button
      data-testid="map-hero-stub"
      data-expanded={String(expanded)}
      onClick={onToggleExpand}
    >
      MAP
    </button>
  ),
}));
vi.mock("@/components/ops/projects/workspace/viewing/activity-tab", () => ({
  ActivityTab: () => <div data-testid="activity-tab-stub" />,
}));
vi.mock("@/components/ops/projects/workspace/viewing/details-tab", () => ({
  DetailsTab: () => <div data-testid="details-tab-stub" />,
}));
vi.mock("@/components/ops/projects/workspace/viewing/accounting-tab", () => ({
  AccountingTab: () => <div data-testid="accounting-tab-stub" />,
}));

const { ProjectViewingBody } = await import(
  "@/components/ops/projects/workspace/viewing/project-viewing-body"
);

const PROJECT = {
  id: "11111111-2222-3333-4444-555555555555",
  title: "Acme HQ",
  address: "1234 Industry Way",
  latitude: 37.95,
  longitude: -121.29,
  startDate: new Date("2026-05-01"),
  endDate: new Date("2026-05-15"),
  status: ProjectStatus.InProgress,
  projectDescription: "Replace flat roof.",
  clientId: null,
};

describe("<ProjectViewingBody>", () => {
  beforeEach(() => {
    mockProject.mockReturnValue({ data: PROJECT, isLoading: false });
    mockCan.mockReturnValue(true);
  });

  it("renders the loading state while project is loading", () => {
    mockProject.mockReturnValue({ data: undefined, isLoading: true });
    render(<ProjectViewingBody projectId="p1" />);
    expect(screen.getByTestId("project-viewing-body-loading")).toBeInTheDocument();
  });

  it("renders MapHero, ScheduleStrip, tabs, and the active tab body", () => {
    render(<ProjectViewingBody projectId="p1" />);
    expect(screen.getByTestId("map-hero-stub")).toBeInTheDocument();
    expect(screen.getByTestId("schedule-strip")).toBeInTheDocument();
    expect(screen.getByTestId("project-viewing-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("activity-tab-stub")).toBeInTheDocument();
  });

  it("defaults to the activity tab", () => {
    render(<ProjectViewingBody projectId="p1" />);
    expect(screen.getByTestId("viewing-body-activity")).toBeInTheDocument();
  });

  it("switches tabs when the user clicks a different tab", async () => {
    render(<ProjectViewingBody projectId="p1" />);
    await userEvent.click(screen.getByRole("tab", { name: /details/i }));
    expect(screen.getByTestId("details-tab-stub")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /accounting/i }));
    expect(screen.getByTestId("accounting-tab-stub")).toBeInTheDocument();
  });

  it("disables the Accounting tab when financial perms are denied", () => {
    mockCan.mockReturnValue(false);
    render(<ProjectViewingBody projectId="p1" />);
    expect(screen.getByRole("tab", { name: /accounting/i })).toBeDisabled();
  });

  it("renders the map placeholder when project lat/lon is missing", () => {
    mockProject.mockReturnValue({
      data: { ...PROJECT, latitude: null, longitude: null },
      isLoading: false,
    });
    render(<ProjectViewingBody projectId="p1" />);
    expect(screen.getByTestId("map-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("map-hero-stub")).not.toBeInTheDocument();
  });

  it("collapses ScheduleStrip + tabs while the map is expanded", async () => {
    render(<ProjectViewingBody projectId="p1" />);
    expect(screen.getByTestId("schedule-strip")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("map-hero-stub"));
    expect(screen.queryByTestId("schedule-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-viewing-tabs")).not.toBeInTheDocument();
  });
});
