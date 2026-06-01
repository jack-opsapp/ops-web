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
    expect(html).toContain("Two weeks in, and it's gone quiet on your end.");
  });

  it("uses first-person 'I'd like to know' (not 'Jack wants to know' third-person)", async () => {
    const html = await render(<Day14Quiet {...previewProps} />, {
      plainText: true,
      htmlToTextOptions: { wordwrap: false },
    });
    expect(html).toContain("I'd like to know");
    expect(html).not.toContain("Jack wants to know");
  });

  it("includes the 'isn't the fit' framing", async () => {
    const html = await render(<Day14Quiet {...previewProps} />, {
      plainText: true,
      htmlToTextOptions: { wordwrap: false },
    });
    expect(html).toContain("OPS isn't the fit");
  });

  it("degrades when firstName is null", async () => {
    const html = await render(
      <Day14Quiet firstName={null} unsubscribeUrl="https://x.test" />,
      { plainText: true, htmlToTextOptions: { wordwrap: false } },
    );
    expect(html).toContain("Hey there,");
  });
});
