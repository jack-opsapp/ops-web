import { describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  row: {
    id: "source",
    title: "Test",
    slug: "test",
    content: "<p>The complete source text.</p>",
    published_at: "2026-09-01T18:32:46.742+00:00",
    is_live: true,
    thumbnail_url: null as string | null,
  },
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.row, error: null }),
        }),
      }),
    }),
  }),
}));
import { createEditorialRepository } from "@/lib/social/editorial/repository";
describe("saved source validation", () => {
  const snapshot = {
    text: "The complete source text.",
    slug: "test",
    title: "Test",
    id: "source",
    is_live: true,
    thumbnail_url: null,
    published_at: "2026-09-01T18:32:46.742+00:00",
  };
  it("accepts the identical source after JSONB reordered its properties", async () => {
    expect(await createEditorialRepository().sourceStillCurrent(snapshot)).toBe(
      true
    );
  });
  it.each([
    { text: "A different source." },
    { is_live: false },
    { thumbnail_url: "https://example.com/different.jpg" },
    { published_at: "2026-09-02T18:32:46.742+00:00" },
  ])("rejects a genuinely changed source %j", async (change) => {
    expect(
      await createEditorialRepository().sourceStillCurrent({
        ...snapshot,
        ...change,
      })
    ).toBe(false);
  });
});
