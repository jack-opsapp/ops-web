import { describe, expect, it } from "vitest";
import { socialReviewNotification } from "@/lib/social/notification-service";
import { socialPostFixture } from "../../helpers/social-fixtures";

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
});
