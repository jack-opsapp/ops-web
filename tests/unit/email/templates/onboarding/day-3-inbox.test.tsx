import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Day3Inbox, previewProps } from "@/lib/email/react/templates/onboarding/Day3Inbox";

describe("Day3Inbox", () => {
  it("renders with previewProps", async () => {
    const html = await render(<Day3Inbox {...previewProps} />);
    expect(html).toContain("Jack again.");
    expect(html).toContain("deck and rail crew");
  });

  it("substitutes firstName when provided", async () => {
    const html = await render(<Day3Inbox firstName="Pat" unsubscribeUrl="https://x.test" />);
    expect(html).toContain("Hey there Pat,");
  });

  it("degrades when firstName is null", async () => {
    const html = await render(<Day3Inbox firstName={null} unsubscribeUrl="https://x.test" />);
    expect(html).toContain("Hey there,");
  });

  it("includes 'Data is power.' (canonical beat)", async () => {
    const html = await render(<Day3Inbox {...previewProps} />);
    expect(html).toContain("Data is power.");
  });

  it("includes 'I read every reply' verbatim", async () => {
    const text = await render(<Day3Inbox {...previewProps} />, { plainText: true });
    expect(text).toContain("I read every reply");
  });

  it("uses 'sub-trade emails' (not 'sub emails' — v3 clarification)", async () => {
    const html = await render(<Day3Inbox {...previewProps} />);
    expect(html).toContain("sub-trade emails");
  });

  it("does NOT contain 'intelligent classification' (v3 removed)", async () => {
    const html = await render(<Day3Inbox {...previewProps} />);
    expect(html).not.toContain("intelligent classification");
  });

  it("does not contain banned vocabulary", async () => {
    const html = await render(<Day3Inbox {...previewProps} />);
    expect(html.toLowerCase()).not.toContain("leverage");
    expect(html.toLowerCase()).not.toContain("seamless");
    expect(html.toLowerCase()).not.toMatch(/\bunlocks?\b/);
  });
});
