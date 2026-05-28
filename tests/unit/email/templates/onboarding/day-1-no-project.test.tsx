import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Day1NoProject, previewProps } from "@/lib/email/react/templates/onboarding/Day1NoProject";

describe("Day1NoProject", () => {
  it("renders with previewProps", async () => {
    const html = await render(<Day1NoProject {...previewProps} />);
    expect(html).toContain("Day 1. You signed up yesterday.");
    expect(html).toContain("drop your first project in");
  });

  it("includes the CTA button pointing at the projects/new URL", async () => {
    const html = await render(
      <Day1NoProject
        ctaUrl="https://app.opsapp.co/projects/new"
        unsubscribeUrl="https://x.test"
      />,
    );
    expect(html).toContain("DROP YOUR FIRST PROJECT");
    expect(html).toContain('href="https://app.opsapp.co/projects/new"');
  });

  it("does not contain banned vocabulary", async () => {
    const html = await render(<Day1NoProject {...previewProps} />);
    expect(html.toLowerCase()).not.toMatch(/\bunlocks?\b/);
    expect(html.toLowerCase()).not.toContain("comes alive");
    expect(html.toLowerCase()).not.toContain("leverage");
  });

  it("includes the visible compliance footer", async () => {
    const html = await render(<Day1NoProject {...previewProps} />);
    expect(html).toContain("OPS LTD.");
    expect(html).toContain("Unsubscribe");
  });
});
