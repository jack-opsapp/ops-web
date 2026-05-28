import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { FounderFooter } from "@/lib/email/react/primitives/FounderFooter";

describe("FounderFooter", () => {
  it("renders the OPS LTD legal address", async () => {
    const html = await render(
      <FounderFooter unsubscribeUrl="https://app.opsapp.co/api/email/unsubscribe?t=abc" />,
    );
    expect(html).toContain("OPS LTD.");
    expect(html).toContain("1515 Douglas St, Victoria, BC V8W 2G4");
  });

  it("renders an Unsubscribe link pointed at the given URL", async () => {
    const url = "https://app.opsapp.co/api/email/unsubscribe?t=abc";
    const html = await render(<FounderFooter unsubscribeUrl={url} />);
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain("Unsubscribe");
  });

  it("renders as plain text with minimal styling", async () => {
    const text = await render(
      <FounderFooter unsubscribeUrl="https://x.test" />,
      { plainText: true },
    );
    expect(text).toMatch(/OPS LTD\..*Victoria, BC.*Unsubscribe/s);
  });
});
