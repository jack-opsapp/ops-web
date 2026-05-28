import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { PlainTextLayout } from "@/lib/email/react/primitives/PlainTextLayout";

describe("PlainTextLayout", () => {
  it("renders body content and footer", async () => {
    const html = await render(
      <PlainTextLayout
        unsubscribeUrl="https://app.opsapp.co/api/email/unsubscribe?t=test"
      >
        Hey there Jackson, this is the body.
      </PlainTextLayout>,
    );
    expect(html).toContain("Hey there Jackson, this is the body.");
    expect(html).toContain("OPS LTD.");
    expect(html).toContain("Unsubscribe");
  });

  it("does NOT render glass card, logo, or branded chrome", async () => {
    const html = await render(
      <PlainTextLayout unsubscribeUrl="https://x.test">body</PlainTextLayout>,
    );
    // Founder emails are stripped — no OPS logo, no glass background
    expect(html).not.toMatch(/ops-mark|ops-lockup|backdrop-blur|rgba\(18, 18, 20/);
  });

  it("preserves newlines in plain-text rendering", async () => {
    const text = await render(
      <PlainTextLayout unsubscribeUrl="https://x.test">
        Line one.{"\n\n"}Line two.
      </PlainTextLayout>,
      { plainText: true },
    );
    expect(text).toContain("Line one.");
    expect(text).toContain("Line two.");
  });
});
