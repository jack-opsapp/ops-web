import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSocialReviewNotification,
  socialReviewNotification,
} from "@/lib/social/notification-service";
import { socialPostFixture } from "../../helpers/social-fixtures";

const inserts: Array<Record<string, unknown>> = [];
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        return { error: null };
      },
    }),
  }),
}));

afterEach(() => {
  inserts.length = 0;
  vi.unstubAllEnvs();
});

describe("Instagram review notification", () => {
  it("names the launch time in Vancouver terms", () => {
    const notification = socialReviewNotification({
      ...socialPostFixture(),
      id: "3f9a1c22-0000-4000-8000-000000000000",
      publish_after: "2026-09-08T17:00:00.000Z",
    });

    expect(notification.title).toBe("INSTAGRAM POST QUEUED · 3F9A1C22");
    expect(notification.body).toBe(
      "Publishes Sep 08 · 10:00 unless stopped. Edit or stop from Social."
    );
  });

  it("falls back to the veto window when no launch time is set", () => {
    const post = socialPostFixture();
    const notification = socialReviewNotification({
      ...post,
      publish_after: null as unknown as string,
    });

    expect(notification.body).toBe(
      "Publishing starts in 10 minutes unless stopped. Edit or stop from Social."
    );
  });

  it("keeps the product register", () => {
    const notification = socialReviewNotification(socialPostFixture());
    expect(notification.title).toBe(notification.title.toUpperCase());
    expect(notification.body).not.toMatch(/[!\u{1F300}-\u{1FAFF}]/u);
  });

  it("addresses the rail item to the normalized production operator", async () => {
    vi.stubEnv("SOCIAL_OPERATOR_USER_ID", "");
    vi.stubEnv("SOCIAL_OPERATOR_COMPANY_ID", "");
    vi.stubEnv("PMF_OPERATOR_USER_ID", " 8d1f6c0e-0000-4000-8000-000000000001\n");
    vi.stubEnv(
      "PMF_OPERATOR_COMPANY_ID",
      "5b2e9a10-0000-4000-8000-000000000002\n"
    );

    await createSocialReviewNotification({
      ...socialPostFixture(),
      id: "3f9a1c22-0000-4000-8000-000000000000",
      publish_after: "2026-09-08T17:00:00.000Z",
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      user_id: "8d1f6c0e-0000-4000-8000-000000000001",
      company_id: "5b2e9a10-0000-4000-8000-000000000002",
      type: "social_post_review",
      title: "INSTAGRAM POST QUEUED · 3F9A1C22",
      persistent: true,
      action_url: "/admin/social?post=3f9a1c22-0000-4000-8000-000000000000",
    });
  });
});
