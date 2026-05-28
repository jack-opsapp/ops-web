import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Day4NoNotification, previewProps } from "@/lib/email/react/templates/onboarding/Day4NoNotification";

describe("Day4NoNotification", () => {
  it("renders with previewProps", async () => {
    const html = await render(<Day4NoNotification {...previewProps} />);
    expect(html).toContain("Day 4.");
    expect(html).toContain("Here&#x27;s the moment you&#x27;re working toward");
  });

  it("renders the mocked push notification in real dispatchTaskCompleted format", async () => {
    const html = await render(<Day4NoNotification {...previewProps} />);
    expect(html).toContain("Task Completed");
    expect(html).toContain("Jake completed");
    expect(html).toContain("Rail Install");
    expect(html).toContain("5611 Batu Rd");
  });

  it("renders the CTA pointing at /settings/team", async () => {
    const html = await render(
      <Day4NoNotification
        ctaUrl="https://app.opsapp.co/settings/team"
        unsubscribeUrl="https://x.test"
      />,
    );
    expect(html).toContain("INVITE YOUR CREW");
    expect(html).toContain('href="https://app.opsapp.co/settings/team"');
  });

  it("includes the closing 'you'll know why we built this' line", async () => {
    const html = await render(<Day4NoNotification {...previewProps} />);
    expect(html).toContain("you&#x27;ll know why we built this");
  });
});
