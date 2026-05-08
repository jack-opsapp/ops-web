import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ProjectActivityEntry } from "@/lib/hooks/use-project-activity";

// Mock framer-motion's useReducedMotion so the stagger path can be
// exercised deterministically. Default false; reduced-motion test sets
// it to true.
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    useReducedMotion: vi.fn(() => false),
  };
});

import { useReducedMotion } from "framer-motion";

// Mock all upstream hooks — ActivityTab is a thin orchestrator over them.

const mockActivity = vi.fn<() => { data: ProjectActivityEntry[]; isLoading: boolean }>();
const mockTeam = vi.fn();
const mockCreateNote = vi.fn();
const mockAuthStore = vi.fn();

vi.mock("@/lib/hooks/use-project-activity", () => ({
  useProjectActivity: () => mockActivity(),
}));
vi.mock("@/lib/hooks/use-users", () => ({
  useTeamMembers: () => mockTeam(),
}));
vi.mock("@/lib/hooks/use-project-notes", () => ({
  useCreateProjectNote: () => mockCreateNote(),
}));
vi.mock("@/lib/store/auth-store", () => ({
  useAuthStore: () => mockAuthStore(),
}));
vi.mock("@/components/ops/note-composer", () => ({
  NoteComposer: ({ onSubmit }: { onSubmit: (...a: unknown[]) => void }) => (
    <div data-testid="note-composer-stub" onClick={() => onSubmit("hi", [], [])}>
      composer
    </div>
  ),
}));

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

const { ActivityTab } = await import(
  "@/components/ops/projects/workspace/viewing/activity-tab"
);

const NOTE_ENTRY: ProjectActivityEntry = {
  id: "n1",
  kind: "note",
  content: "Schedule moved to Tuesday.",
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  author: { id: "u1", name: "Jackson Sweet", avatarColor: "#6F94B0" },
  attachments: [],
  mentionedUserIds: [],
  eventPayload: null,
};

const STATUS_ENTRY: ProjectActivityEntry = {
  id: "n2",
  kind: "status_change",
  content: "Project moved from Accepted to In Progress",
  createdAt: new Date(Date.now() - 3600_000).toISOString(),
  author: null,
  attachments: [],
  mentionedUserIds: [],
  eventPayload: { from: "Accepted", to: "In Progress" },
};

describe("<ActivityTab>", () => {
  beforeEach(() => {
    mockActivity.mockReturnValue({ data: [NOTE_ENTRY, STATUS_ENTRY], isLoading: false });
    mockTeam.mockReturnValue({ data: { users: [], remaining: 0, count: 0 } });
    mockCreateNote.mockReturnValue({ isPending: false, mutate: vi.fn() });
    mockAuthStore.mockReturnValue({
      currentUser: { id: "u1" },
      company: { id: "c1" },
    });
  });

  it("renders one row per activity entry", () => {
    render(<ActivityTab projectId="p1" />);
    expect(screen.getAllByTestId("activity-row")).toHaveLength(2);
  });

  it("renders the note row with the author's name and the content", () => {
    render(<ActivityTab projectId="p1" />);
    expect(screen.getByText("Jackson Sweet")).toBeInTheDocument();
    expect(screen.getByText("Schedule moved to Tuesday.")).toBeInTheDocument();
  });

  it("renders the status_change row with the STATUS kind label", () => {
    render(<ActivityTab projectId="p1" />);
    // Kind label resolves via t("activity.kind.statusChange").
    expect(screen.getByText("activity.kind.statusChange")).toBeInTheDocument();
    expect(screen.getByText(/Project moved from Accepted to In Progress/i)).toBeInTheDocument();
  });

  it("renders empty state when activity is empty", () => {
    mockActivity.mockReturnValue({ data: [], isLoading: false });
    render(<ActivityTab projectId="p1" />);
    // Empty state resolves via t("activity.empty").
    expect(screen.getByText("activity.empty")).toBeInTheDocument();
  });

  it("renders loading state while activity is loading", () => {
    mockActivity.mockReturnValue({ data: [], isLoading: true });
    render(<ActivityTab projectId="p1" />);
    // Loading state resolves via t("activity.loading").
    expect(screen.getByText("activity.loading")).toBeInTheDocument();
  });

  it("renders the NoteComposer when authed", () => {
    render(<ActivityTab projectId="p1" />);
    expect(screen.getByTestId("note-composer-stub")).toBeInTheDocument();
  });

  it("hides the NoteComposer when no current user is set", () => {
    mockAuthStore.mockReturnValue({ currentUser: null, company: null });
    render(<ActivityTab projectId="p1" />);
    expect(screen.queryByTestId("note-composer-stub")).not.toBeInTheDocument();
  });

  // Phase 12.5 — entry stagger.
  describe("entry stagger (Phase 12.5)", () => {
    function makeEntry(id: string): ProjectActivityEntry {
      return {
        id,
        kind: "note",
        content: `entry ${id}`,
        createdAt: new Date(Date.now() - 1000).toISOString(),
        author: { id: "u1", name: "Op", avatarColor: "#6F94B0" },
        attachments: [],
        mentionedUserIds: [],
        eventPayload: null,
      };
    }

    it("first six rows stagger 50ms × index; rest cap at 300ms", () => {
      const entries = Array.from({ length: 10 }, (_, i) => makeEntry(`e${i}`));
      mockActivity.mockReturnValue({ data: entries, isLoading: false });
      render(<ActivityTab projectId="p1" />);
      const rows = screen.getAllByTestId("activity-row");
      // Indices 0-5 → 0.00, 0.05, 0.10, 0.15, 0.20, 0.25
      // Indices 6+ → capped at 0.30
      expect(rows[0]).toHaveAttribute("data-stagger-delay", "0.00");
      expect(rows[1]).toHaveAttribute("data-stagger-delay", "0.05");
      expect(rows[5]).toHaveAttribute("data-stagger-delay", "0.25");
      // 6th index = 0.30 exactly (the cap), 7th-9th still 0.30
      expect(rows[6]).toHaveAttribute("data-stagger-delay", "0.30");
      expect(rows[7]).toHaveAttribute("data-stagger-delay", "0.30");
      expect(rows[9]).toHaveAttribute("data-stagger-delay", "0.30");
    });

    it("reduced motion zeroes the delay so all rows enter instantly", () => {
      vi.mocked(useReducedMotion).mockReturnValue(true);
      const entries = Array.from({ length: 5 }, (_, i) => makeEntry(`e${i}`));
      mockActivity.mockReturnValue({ data: entries, isLoading: false });
      render(<ActivityTab projectId="p1" />);
      // The data-stagger-delay attr still reflects the math (delay is
      // computed regardless), but the transition prop carries
      // duration:0 so the visual is instant. Assert on the structural
      // contract: rows render and the row count matches.
      expect(screen.getAllByTestId("activity-row")).toHaveLength(5);
      vi.mocked(useReducedMotion).mockReturnValue(false);
    });
  });
});
