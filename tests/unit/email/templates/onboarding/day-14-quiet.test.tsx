import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Day14Quiet, previewProps } from "@/lib/email/react/templates/onboarding/Day14Quiet";

describe("Day14Quiet", () => {
  it("renders with previewProps", async () => {
    const html = await render(<Day14Quiet {...previewProps} />, {
      plainText: true,
      htmlToTextOptions: { wordwrap: false },
    });
    expect(html).toContain("Jack here.");
    expect(html).toContain("Day 14. You're halfway through your trial");
    expect(html).toContain("quiet on your account");
  });

  it("uses first-person 'I want to know' (not 'Jack wants to know' third-person)", async () => {
    const html = await render(<Day14Quiet {...previewProps} />, {
      plainText: true,
      htmlToTextOptions: { wordwrap: false },
    });
    expect(html).toContain("I want to know");
    expect(html).not.toContain("Jack wants to know");
  });

  it("includes the binary slotting-in vs in-the-way framing", async () => {
    const html = await render(<Day14Quiet {...previewProps} />, {
      plainText: true,
      htmlToTextOptions: { wordwrap: false },
    });
    expect(html).toContain("OPS didn't fit how you run things");
  });

  it("degrades when firstName is null", async () => {
    const html = await render(
      <Day14Quiet firstName={null} unsubscribeUrl="https://x.test" />,
      { plainText: true, htmlToTextOptions: { wordwrap: false } },
    );
    expect(html).toContain("Hey there,");
  });
});
