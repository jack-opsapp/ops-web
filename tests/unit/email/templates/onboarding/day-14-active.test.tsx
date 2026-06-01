import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Day14Active, previewProps } from "@/lib/email/react/templates/onboarding/Day14Active";

const PLAIN = { plainText: true, htmlToTextOptions: { wordwrap: false } } as const;

describe("Day14Active", () => {
  it("renders with previewProps", async () => {
    const html = await render(<Day14Active {...previewProps} />, PLAIN);
    expect(html).toContain("Jack here.");
    expect(html).toContain("Two weeks in, and you've been putting OPS to work.");
  });

  it("renders the two-question structure", async () => {
    const html = await render(
      <Day14Active firstName="Pat" unsubscribeUrl="https://x.test" />,
      PLAIN,
    );
    expect(html).toContain("What's working better than you figured it would?");
    expect(html).toContain("What's getting in your way?");
    expect(html).toContain("Reply here — comes straight to me");
  });

  it("does NOT leak per-account counts (no surveillance-y stats line)", async () => {
    const html = await render(<Day14Active {...previewProps} />, PLAIN);
    expect(html).not.toContain("projects,");
    expect(html).not.toContain("tasks assigned");
    expect(html).not.toContain("completion notification");
    expect(html).not.toContain("landed on your phone");
  });

  it("degrades when firstName is null", async () => {
    const html = await render(
      <Day14Active firstName={null} unsubscribeUrl="https://x.test" />,
      PLAIN,
    );
    expect(html).toContain("Hey there,");
  });
});
