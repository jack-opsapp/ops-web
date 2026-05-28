import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Day1HasProject, previewProps } from "@/lib/email/react/templates/onboarding/Day1HasProject";

describe("Day1HasProject", () => {
  it("renders 'first project' singular when projectCount === 1", async () => {
    const html = await render(
      <Day1HasProject
        projectCount={1}
        ctaUrl="https://app.opsapp.co/dashboard"
        unsubscribeUrl="https://x.test"
      />,
      { plainText: true },
    );
    expect(html).toContain("You've already got your first project in.");
    expect(html).not.toContain("You've got 1 projects in");
  });

  it("renders count + plural when projectCount > 1", async () => {
    const html = await render(
      <Day1HasProject
        projectCount={3}
        ctaUrl="https://app.opsapp.co/dashboard"
        unsubscribeUrl="https://x.test"
      />,
      { plainText: true },
    );
    expect(html).toContain("You've got 3 projects in.");
  });

  it("includes the next-step copy + CTA", async () => {
    const html = await render(<Day1HasProject {...previewProps} />);
    expect(html).toContain("tasks on those projects");
    expect(html).toContain("ASSIGN A TASK + INVITE A CREW MEMBER");
  });

  it("does not contain banned vocabulary", async () => {
    const html = await render(<Day1HasProject {...previewProps} />);
    expect(html.toLowerCase()).not.toMatch(/\bunlocks?\b/);
    expect(html.toLowerCase()).not.toContain("leverage");
    expect(html.toLowerCase()).not.toContain("comes alive");
  });
});
