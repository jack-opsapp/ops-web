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
    const text = await render(<Day0Welcome {...previewProps} />, {
      plainText: true,
    });
    expect(text).toContain("it's my personal inbox");
  });
});
