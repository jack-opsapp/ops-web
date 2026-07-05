import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { LostYou, previewProps } from "@/lib/email/react/templates/onboarding/LostYou";

const PLAIN = { plainText: true, htmlToTextOptions: { wordwrap: false } } as const;

describe("LostYou", () => {
  it("renders with previewProps", async () => {
    const html = await render(<LostYou {...previewProps} />, PLAIN);
    expect(html).toContain("Jack here.");
    expect(html).toContain("since you last opened OPS");
  });

  it("surfaces the real inactivity gap as a single number", async () => {
    const html = await render(
      <LostYou
        firstName="Pat"
        daysSinceLastActivity={9}
        unsubscribeUrl="https://x.test"
      />,
      PLAIN,
    );
    expect(html).toContain("It's been 9 days since you last opened OPS");
  });

  it("uses 'a day' (never '1 days') when the gap is exactly 1", async () => {
    const html = await render(
      <LostYou
        firstName="Pat"
        daysSinceLastActivity={1}
        unsubscribeUrl="https://x.test"
      />,
      PLAIN,
    );
    expect(html).toContain("It's been a day since you last opened OPS");
    expect(html).not.toContain("1 days");
  });

  it("does NOT ship the old self-contradictory two-number sentence (bug a4882017)", async () => {
    const html = await render(<LostYou {...previewProps} />, PLAIN);
    expect(html).not.toContain("signed up for OPS");
    expect(html).not.toContain("haven't been back in");
  });

  it("does NOT include 'That's a real signal' or 'Noticed...' (v3 CRM-flavored cuts)", async () => {
    const html = await render(<LostYou {...previewProps} />, PLAIN);
    expect(html).not.toContain("That's a real signal");
    expect(html).not.toMatch(/^Noticed/m);
  });
});
