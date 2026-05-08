import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ProjectActivityEntry } from "@/lib/hooks/use-project-activity";

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
    expect(screen.getByText("STATUS")).toBeInTheDocument();
    expect(screen.getByText(/Project moved from Accepted to In Progress/i)).toBeInTheDocument();
  });

  it("renders empty state when activity is empty", () => {
    mockActivity.mockReturnValue({ data: [], isLoading: false });
    render(<ActivityTab projectId="p1" />);
    expect(screen.getByText(/No activity yet/i)).toBeInTheDocument();
  });

  it("renders loading state while activity is loading", () => {
    mockActivity.mockReturnValue({ data: [], isLoading: true });
    render(<ActivityTab projectId="p1" />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
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
});
