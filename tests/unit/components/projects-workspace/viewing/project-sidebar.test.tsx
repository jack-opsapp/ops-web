import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectStatus } from "@/lib/types/models";

const mockProject = vi.fn();
const mockClient = vi.fn();
const mockTeam = vi.fn();
const mockTasks = vi.fn();
const mockLedger = vi.fn();
const mockPipeline = vi.fn();
const mockWeather = vi.fn();
const mockCan = vi.fn();

vi.mock("@/lib/hooks/use-projects", () => ({ useProject: () => mockProject() }));
vi.mock("@/lib/hooks/use-clients", () => ({ useClient: () => mockClient() }));
vi.mock("@/lib/hooks/use-project-team", () => ({ useProjectTeam: () => mockTeam() }));
vi.mock("@/lib/hooks/use-project-tasks-grouped", () => ({
  useProjectTasksGrouped: () => mockTasks(),
}));
vi.mock("@/lib/hooks/use-project-ledger", () => ({
  useProjectLedger: () => mockLedger(),
}));
vi.mock("@/lib/hooks/use-project-pipeline", () => ({
  useProjectPipeline: () => mockPipeline(),
}));
vi.mock("@/lib/hooks/use-weather", () => ({ useWeather: () => mockWeather() }));
vi.mock("@/lib/store/permissions-store", () => ({
  usePermissionStore: (selector: (s: { can: (p: string) => boolean }) => unknown) =>
    selector({ can: mockCan }),
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

const { ProjectSidebar } = await import(
  "@/components/ops/projects/workspace/viewing/project-sidebar"
);

const PROJECT = {
  id: "p1",
  title: "Acme HQ",
  address: "1234 Industry Way, Stockton CA",
  latitude: 37.95,
  longitude: -121.29,
  startDate: new Date("2026-05-01"),
  endDate: new Date("2026-05-15"),
  status: ProjectStatus.InProgress,
  clientId: "c1",
  projectDescription: null,
};

describe("<ProjectSidebar>", () => {
  beforeEach(() => {
    mockProject.mockReturnValue({ data: PROJECT });
    mockClient.mockReturnValue({
      data: {
        id: "c1",
        name: "Acme Holdings LLC",
        email: "ops@acme.example",
        phoneNumber: "5551112222",
      },
    });
    mockTeam.mockReturnValue({
      members: [
        {
          id: "u1",
          name: "Jackson Sweet",
          email: null,
          phone: null,
          avatarColor: "#6F94B0",
          profileImageURL: null,
          taskTypeNames: ["Roofing"],
        },
      ],
    });
    mockTasks.mockReturnValue({
      data: { done: [], active: [], upcoming: [], totals: { done: 2, total: 5 } },
    });
    mockLedger.mockReturnValue({
      data: [
        {
          recordId: "Q-100",
          description: "x",
          status: "approved",
          statusTone: "olive",
          date: "2026-05-01",
          amount: 10000,
          amountTone: "text",
          source: "estimate",
        },
        {
          recordId: "I-200",
          description: "y",
          status: "sent",
          statusTone: "tan",
          date: "2026-05-02",
          amount: 5000,
          amountTone: "text",
          source: "invoice",
        },
      ],
      isLoading: false,
    });
    mockPipeline.mockReturnValue({
      data: {
        quoted: { total: 10000, recordId: null },
        invoiced: { total: 5000, recordId: null, changeOrdersCount: 0 },
        received: { total: 1000, recordId: null, depositPct: null },
        outstanding: { total: 4000, dueDate: null, daysAged: 5 },
      },
    });
    mockWeather.mockReturnValue({
      data: {
        current: {
          id: "w0",
          projectId: "p1",
          companyId: "c1",
          forecastDate: "2026-05-07",
          tempHighC: 22,
          tempLowC: 12,
          tempCurrentC: 18,
          precipitationMm: null,
          precipitationProbability: null,
          windSpeedKmh: null,
          conditions: "clear",
          retrievedAt: "2026-05-07T00:00:00Z",
          source: "open-meteo" as const,
        },
        forecast: [],
        attribution: "Weather data by Open-Meteo.com" as const,
      },
      isLoading: false,
    });
    mockCan.mockReturnValue(true);
  });

  it("renders all 7 section titles", () => {
    render(<ProjectSidebar projectId="p1" />);
    // Section titles resolve via the project-workspace dictionary; the
    // test mock returns each key as the rendered text.
    for (const key of [
      "sidebar.health.section",
      "sidebar.client.section",
      "sidebar.location.section",
      "sidebar.team.section",
      "sidebar.dates.section",
      "sidebar.weather.section",
      "sidebar.linked.section",
    ]) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
  });

  it("renders the health progress bar with the right width", () => {
    render(<ProjectSidebar projectId="p1" />);
    const bar = screen.getByTestId("health-progress") as HTMLElement;
    // 2/5 = 40%
    expect(bar.style.width).toBe("40%");
  });

  it("renders client name + linkified email + tel", () => {
    render(<ProjectSidebar projectId="p1" />);
    expect(screen.getByText("Acme Holdings LLC")).toBeInTheDocument();
    expect(screen.getByText("ops@acme.example").closest("a"))
      .toHaveAttribute("href", "mailto:ops@acme.example");
  });

  it("renders the location with Maps link when address is present", () => {
    render(<ProjectSidebar projectId="p1" />);
    expect(screen.getByText("1234 Industry Way, Stockton CA")).toBeInTheDocument();
    // MAPS link text resolves via t("sidebar.location.maps").
    expect(
      screen
        .getByText("sidebar.location.maps")
        .closest("a")
        ?.getAttribute("href"),
    ).toMatch(/maps\/search/);
  });

  it("renders all team members with task type assignments", () => {
    render(<ProjectSidebar projectId="p1" />);
    expect(screen.getByText("Jackson Sweet")).toBeInTheDocument();
    expect(screen.getByText("Roofing")).toBeInTheDocument();
  });

  it("renders dates section with start, end, and computed duration", () => {
    render(<ProjectSidebar projectId="p1" />);
    // Dates labels resolve via the project-workspace dictionary.
    expect(screen.getByText("sidebar.dates.start")).toBeInTheDocument();
    expect(screen.getByText("sidebar.dates.end")).toBeInTheDocument();
    expect(screen.getByText("sidebar.dates.duration")).toBeInTheDocument();
    expect(screen.getByText(/14D|15D/)).toBeInTheDocument();
  });

  it("renders weather current temp", () => {
    render(<ProjectSidebar projectId="p1" />);
    expect(screen.getByText(/18°/)).toBeInTheDocument();
  });

  it("renders the LINKED count `1E · 1I` based on ledger", () => {
    render(<ProjectSidebar projectId="p1" />);
    expect(screen.getByText("1E · 1I")).toBeInTheDocument();
  });

  it("renders the LINKED restricted state when financial perms are denied", () => {
    mockCan.mockReturnValue(false);
    render(<ProjectSidebar projectId="p1" />);
    // Restricted message resolves via t("sidebar.linked.restricted").
    expect(screen.getByText("sidebar.linked.restricted")).toBeInTheDocument();
  });

  it("hides the financial tiles in HEALTH when financial perms are denied", () => {
    mockCan.mockReturnValue(false);
    render(<ProjectSidebar projectId="p1" />);
    // Tile labels resolve via the project-workspace dictionary.
    expect(screen.queryByText("sidebar.health.invoiced")).not.toBeInTheDocument();
    expect(screen.queryByText("sidebar.health.outstanding")).not.toBeInTheDocument();
  });
});
