import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Day0Welcome, previewProps } from "@/lib/email/react/templates/onboarding/Day0Welcome";

describe("Day0Welcome", () => {
  it("renders with previewProps", async () => {
    const html = await render(<Day0Welcome {...previewProps} />);
    expect(html).toContain("My name is Jack, I built OPS.");
    expect(html).toContain("OPS LTD.");
  });

  it("substitutes firstName when provided", async () => {
    const html = await render(
      <Day0Welcome firstName="Pat" unsubscribeUrl="https://x.test" />,
    );
    expect(html).toContain("Hey there Pat,");
  });

  it("degrades to 'Hey there,' when firstName is null", async () => {
    const html = await render(
      <Day0Welcome firstName={null} unsubscribeUrl="https://x.test" />,
    );
    expect(html).toContain("Hey there,");
    expect(html).not.toContain("Hey there null");
    expect(html).not.toContain("Hey there ,");
  });

  it("includes the personal-inbox close (load-bearing)", async () => {
    // Use the production render path (renderTemplate from template-registry)
    // which disables html-to-text wordwrap. Direct render({ plainText: true })
    // wordwraps at 80 cols and can split load-bearing phrases mid-line.
    const text = await render(<Day0Welcome {...previewProps} />, {
      plainText: true,
      htmlToTextOptions: { wordwrap: false },
    } as Parameters<typeof render>[1]);
    expect(text).toContain("it's my personal inbox");
  });
});
