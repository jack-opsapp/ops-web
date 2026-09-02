import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SocialCommandDeck } from "@/app/admin/social/_components/social-command-deck";
import { socialPostFixture } from "../../helpers/social-fixtures";

const mutateAsync = vi.fn();
const connectMutateAsync = vi.fn();
const disconnectMutateAsync = vi.fn();
let posts = [socialPostFixture({ status: "review", publish_stage: "idle" })];
let instagramConnection:
  | {
      connected: true;
      username: string;
      connectedAt: string;
      tokenExpiresAt: string;
      lastRefreshedAt: string | null;
      needsReconnect: false;
    }
  | {
      connected: false;
      reason: "not_connected" | "expired";
      needsReconnect: boolean;
      username?: string;
    } = {
  connected: true,
  username: "opsjournal",
  connectedAt: "2026-09-01T20:00:00.000Z",
  tokenExpiresAt: "2026-11-01T20:00:00.000Z",
  lastRefreshedAt: null,
  needsReconnect: false,
};

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === "string" ? fallback : _key,
  }),
}));

vi.mock("@/lib/hooks/use-social-posts", () => ({
  useSocialPosts: () => ({
    posts,
    isLoading: false,
    error: null,
    action: { mutateAsync, isPending: false },
  }),
  useInstagramConnection: () => ({
    connection: instagramConnection,
    isLoading: false,
    error: null,
    connect: { mutateAsync: connectMutateAsync, isPending: false },
    disconnect: { mutateAsync: disconnectMutateAsync, isPending: false },
  }),
}));

describe("SocialCommandDeck", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    connectMutateAsync.mockReset();
    disconnectMutateAsync.mockReset();
    mutateAsync.mockResolvedValue({
      post: socialPostFixture({ status: "cancelled" }),
    });
    connectMutateAsync.mockImplementation(() => new Promise(() => undefined));
    disconnectMutateAsync.mockResolvedValue({ ok: true });
    posts = [socialPostFixture({ status: "review", publish_stage: "idle" })];
    instagramConnection = {
      connected: true,
      username: "opsjournal",
      connectedAt: "2026-09-01T20:00:00.000Z",
      tokenExpiresAt: "2026-11-01T20:00:00.000Z",
      lastRefreshedAt: null,
      needsReconnect: false,
    };
  });

  it("makes account login the only primary launch action while disconnected", async () => {
    instagramConnection = {
      connected: false,
      reason: "not_connected",
      needsReconnect: false,
    };
    render(<SocialCommandDeck />);

    expect(
      screen.getByRole("button", { name: "CONNECT INSTAGRAM" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "PUBLISH NOW" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("LOGIN ONCE. OPS KEEPS PUBLISHING ACCESS CURRENT.")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "CONNECT INSTAGRAM" }));
    await waitFor(() => expect(connectMutateAsync).toHaveBeenCalledTimes(1));
  });

  it("keeps disconnect behind the compact connected-account control", async () => {
    render(<SocialCommandDeck />);

    expect(
      screen.queryByRole("button", { name: "DISCONNECT" })
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "@opsjournal · CONNECTED" })
    );
    fireEvent.click(screen.getByRole("button", { name: "DISCONNECT" }));
    expect(screen.getByText("DISCONNECT INSTAGRAM?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM DISCONNECT" }));

    await waitFor(() => expect(disconnectMutateAsync).toHaveBeenCalledTimes(1));
  });

  it("presents the launch rail, exact artwork, and operator controls", () => {
    render(<SocialCommandDeck />);

    expect(screen.getByRole("heading", { name: "SOCIAL" })).toBeInTheDocument();
    expect(screen.getAllByText("The two-hour leak in your week")).toHaveLength(
      2
    );
    expect(
      screen.getByRole("img", {
        name: "A field note about repeated crew coordination.",
      })
    ).toHaveAttribute("src", "https://cdn.opsapp.ca/social/slide-1.jpg");
    expect(
      screen.getByRole("button", { name: "PUBLISH NOW" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "STOP" })).toBeInTheDocument();
    expect(screen.getByText("HOOK")).toBeInTheDocument();
    expect(screen.getByText("ANGLE")).toBeInTheDocument();
    expect(screen.getByText("SELECTION RATIONALE")).toBeInTheDocument();
    expect(screen.getByText("RENDER EVIDENCE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ALL" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "ACTIVE" })).toHaveClass(
      "text-text-3"
    );
    expect(screen.getByText("SELECTED").closest("button")).toHaveAttribute(
      "aria-current",
      "true"
    );
    expect(screen.getByText("SELECTED")).toHaveClass("text-text-2");
  });

  it("requires a deliberate confirmation before stopping a queued post", async () => {
    render(<SocialCommandDeck />);

    fireEvent.click(screen.getByRole("button", { name: "STOP" }));
    expect(screen.getByText("STOP THIS POST?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM STOP" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        id: socialPostFixture().id,
        body: { action: "cancel" },
      });
    });
  });

  it("sends the complete structured copy package when an edit is saved", async () => {
    render(<SocialCommandDeck />);

    fireEvent.click(screen.getByRole("button", { name: "EDIT COPY" }));
    const title = screen.getByLabelText("TITLE");
    fireEvent.change(title, {
      target: { value: "Close the loop before Friday" },
    });
    fireEvent.click(screen.getByRole("button", { name: "SAVE + REGENERATE" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: socialPostFixture().id,
          body: expect.objectContaining({
            action: "edit",
            content: expect.objectContaining({
              title: "Close the loop before Friday",
            }),
          }),
        })
      );
    });
  });

  it("makes a failed post recoverable and a published post immutable", () => {
    posts = [
      socialPostFixture({
        status: "failed",
        publish_stage: "idle",
        last_error_code: "META_BUSY",
        last_error_message: "Meta timed out",
      }),
      socialPostFixture({
        id: "ffdcf84e-efef-4196-a092-587a7bc51a79",
        status: "published",
        content: { ...socialPostFixture().content, title: "Published proof" },
      }),
    ];
    const { rerender } = render(<SocialCommandDeck />);

    expect(
      screen.getByRole("button", { name: "RETRY NOW" })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Published proof"));
    rerender(<SocialCommandDeck />);
    expect(screen.getByText("LOCKED AFTER PUBLISH")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "PUBLISH NOW" })
    ).not.toBeInTheDocument();
  });

  it("locks an uncertain publish for reconciliation instead of offering a retry", () => {
    posts = [
      socialPostFixture({
        status: "failed",
        publish_stage: "reconciliation_required",
        last_error_code: "PUBLISH_OUTCOME_UNKNOWN",
        last_error_message: "The response was uncertain.",
      }),
    ];

    render(<SocialCommandDeck />);

    expect(screen.getAllByText("RECONCILIATION REQUIRED")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "RETRY NOW" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "EDIT COPY" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "STOP" })
    ).not.toBeInTheDocument();
  });

  it("opens the exact notification-linked post and otherwise selects the next due item", () => {
    const linked = socialPostFixture({
      id: "ffdcf84e-efef-4196-a092-587a7bc51a79",
      status: "published",
      content: { ...socialPostFixture().content, title: "Notification target" },
      updated_at: "2026-09-01T20:05:00.000Z",
    });
    const later = socialPostFixture({
      id: "108b7764-20f5-4e67-a0bf-3098a472feac",
      status: "review",
      content: { ...socialPostFixture().content, title: "Later launch" },
      publish_after: "2026-09-01T21:00:00.000Z",
    });
    const next = socialPostFixture({
      status: "review",
      publish_after: "2026-09-01T20:10:00.000Z",
    });
    posts = [later, linked, next];

    const { unmount } = render(<SocialCommandDeck />);
    expect(
      screen.getByRole("heading", { name: "The two-hour leak in your week" })
    ).toBeInTheDocument();
    unmount();

    render(<SocialCommandDeck initialPostId={linked.id} />);
    expect(
      screen.getByRole("heading", { name: "Notification target" })
    ).toBeInTheDocument();
    expect(screen.getByText("LOCKED AFTER PUBLISH")).toBeInTheDocument();
  });
});
