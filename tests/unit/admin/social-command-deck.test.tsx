import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SocialCommandDeck } from "@/app/admin/social/_components/social-command-deck";
import { socialPostFixture } from "../../helpers/social-fixtures";

const mutateAsync = vi.fn();
let posts = [socialPostFixture({ status: "review" })];

vi.mock("@/i18n", () => ({
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
}));

describe("SocialCommandDeck", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({ post: socialPostFixture({ status: "cancelled" }) });
    posts = [socialPostFixture({ status: "review" })];
  });

  it("presents the launch rail, exact artwork, and operator controls", () => {
    render(<SocialCommandDeck />);

    expect(screen.getByRole("heading", { name: "SOCIAL" })).toBeInTheDocument();
    expect(screen.getAllByText("The two-hour leak in your week")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "A field note about repeated crew coordination." })).toHaveAttribute(
      "src",
      "https://cdn.opsapp.ca/social/slide-1.jpg"
    );
    expect(screen.getByRole("button", { name: "PUBLISH NOW" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "STOP" })).toBeInTheDocument();
  });

  it("requires a deliberate confirmation before stopping a queued post", async () => {
    render(<SocialCommandDeck />);

    fireEvent.click(screen.getByRole("button", { name: "STOP" }));
    expect(screen.getByText("STOP THIS POST?" )).toBeInTheDocument();
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
    fireEvent.change(title, { target: { value: "Close the loop before Friday" } });
    fireEvent.click(screen.getByRole("button", { name: "SAVE + REGENERATE" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: socialPostFixture().id,
          body: expect.objectContaining({
            action: "edit",
            content: expect.objectContaining({ title: "Close the loop before Friday" }),
          }),
        })
      );
    });
  });

  it("makes a failed post recoverable and a published post immutable", () => {
    posts = [
      socialPostFixture({ status: "failed", last_error_message: "Meta timed out" }),
      socialPostFixture({
        id: "ffdcf84e-efef-4196-a092-587a7bc51a79",
        status: "published",
        content: { ...socialPostFixture().content, title: "Published proof" },
      }),
    ];
    const { rerender } = render(<SocialCommandDeck />);

    expect(screen.getByRole("button", { name: "RETRY NOW" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Published proof"));
    rerender(<SocialCommandDeck />);
    expect(screen.getByText("LOCKED AFTER PUBLISH" )).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "PUBLISH NOW" })).not.toBeInTheDocument();
  });
});
