import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Day14Active, previewProps } from "@/lib/email/react/templates/onboarding/Day14Active";

const PLAIN = { plainText: true, htmlToTextOptions: { wordwrap: false } } as const;

describe("Day14Active", () => {
  it("renders stats line when sum >= 5", async () => {
    const html = await render(
      <Day14Active
        firstName="Pat"
        projectCount={3}
        taskCount={7}
        notificationCount={2}
        unsubscribeUrl="https://x.test"
      />,
      PLAIN,
    );
    expect(html).toContain("Day 14. You're running OPS — 3 projects, 7 tasks assigned, 2 completion notifications");
  });

  it("renders pluralization correctly (1 project, 1 task, 3 notifications)", async () => {
    const html = await render(
      <Day14Active
        firstName="Pat"
        projectCount={1}
        taskCount={1}
        notificationCount={3}
        unsubscribeUrl="https://x.test"
      />,
      PLAIN,
    );
    // sum is 5, so stats line renders. Singular for 1, plural for 3.
    expect(html).toMatch(/1 project,/);
    expect(html).toMatch(/1 task /);
    expect(html).toMatch(/3 completion notifications/);
  });

  it("suppresses stats line when sum < 5 (renders no-stats variant)", async () => {
    const html = await render(
      <Day14Active
        firstName="Pat"
        projectCount={1}
        taskCount={2}
        notificationCount={1}
        unsubscribeUrl="https://x.test"
      />,
      PLAIN,
    );
    expect(html).toContain("Day 14. You're moving in OPS.");
    expect(html).not.toContain("projects,");
    expect(html).not.toContain("tasks assigned");
  });

  it("renders the two-question structure in both variants", async () => {
    const lowStatsHtml = await render(
      <Day14Active firstName="Pat" projectCount={0} taskCount={1} notificationCount={0} unsubscribeUrl="https://x.test" />,
      PLAIN,
    );
    const highStatsHtml = await render(
      <Day14Active firstName="Pat" projectCount={5} taskCount={10} notificationCount={2} unsubscribeUrl="https://x.test" />,
      PLAIN,
    );
    for (const html of [lowStatsHtml, highStatsHtml]) {
      expect(html).toContain("What's working that you didn't expect");
      expect(html).toContain("What's broken, missing, or in the way");
    }
  });
});
