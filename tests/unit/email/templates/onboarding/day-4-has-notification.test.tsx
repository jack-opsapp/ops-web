import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Day4HasNotification, previewProps } from "@/lib/email/react/templates/onboarding/Day4HasNotification";

describe("Day4HasNotification", () => {
  it("renders with previewProps", async () => {
    const html = await render(<Day4HasNotification {...previewProps} />);
    expect(html).toContain("Day 4. At least one crew member has tapped DONE");
    expect(html).toContain("the quiet of not having to chase");
  });

  it("includes the three compounding moves", async () => {
    const html = await render(<Day4HasNotification {...previewProps} />);
    expect(html).toContain("Recurring jobs");
    expect(html).toContain("Adding more crew, so the same setup covers more work");
    expect(html).toContain("Templates so you don&#x27;t rebuild");
  });

  it("CTA points at recurring projects filter", async () => {
    const html = await render(
      <Day4HasNotification
        ctaUrl="https://app.opsapp.co/projects?filter=recurring"
        unsubscribeUrl="https://x.test"
      />,
    );
    expect(html).toContain("SET UP RECURRING JOBS");
    expect(html).toContain('href="https://app.opsapp.co/projects?filter=recurring"');
  });

  it("does NOT contain 'leverage' (v3 banned-word fix)", async () => {
    const html = await render(<Day4HasNotification {...previewProps} />);
    expect(html.toLowerCase()).not.toContain("leverage");
  });
});
