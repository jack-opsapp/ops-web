import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { LostYou, previewProps } from "@/lib/email/react/templates/onboarding/LostYou";

const PLAIN = { plainText: true, htmlToTextOptions: { wordwrap: false } } as const;

describe("LostYou", () => {
  it("renders with previewProps", async () => {
    const html = await render(<LostYou {...previewProps} />, PLAIN);
    expect(html).toContain("Jack here.");
    expect(html).toContain("haven't been back in");
  });

  it("substitutes days since signup and days since last activity", async () => {
    const html = await render(
      <LostYou
        firstName="Pat"
        daysSinceSignup={9}
        daysSinceLastActivity={6}
        unsubscribeUrl="https://x.test"
      />,
      PLAIN,
    );
    expect(html).toContain("You signed up for OPS 9 days ago");
    expect(html).toContain("haven't been back in 6 days");
  });

  it("uses 'a day' (not '1 days') when daysSinceLastActivity === 1", async () => {
    const html = await render(
      <LostYou
        firstName="Pat"
        daysSinceSignup={2}
        daysSinceLastActivity={1}
        unsubscribeUrl="https://x.test"
      />,
      PLAIN,
    );
    expect(html).toContain("haven't been back in a day");
    expect(html).not.toContain("1 days");
  });

  it("does NOT include 'That's a real signal' or 'Noticed...' (v3 CRM-flavored cuts)", async () => {
    const html = await render(<LostYou {...previewProps} />, PLAIN);
    expect(html).not.toContain("That's a real signal");
    expect(html).not.toMatch(/^Noticed/m);
  });
});
