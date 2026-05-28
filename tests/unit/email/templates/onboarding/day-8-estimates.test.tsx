import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { Day8Estimates, previewProps } from "@/lib/email/react/templates/onboarding/Day8Estimates";

describe("Day8Estimates", () => {
  it("renders with previewProps", async () => {
    const html = await render(<Day8Estimates {...previewProps} />, {
      plainText: true,
      htmlToTextOptions: { wordwrap: false },
    });
    expect(html).toContain("Jack again, last one of these you'll get from me for a while.");
    expect(html).toContain("deck builder I know");
  });

  it("includes the 20% mid-job disaster moment (load-bearing)", async () => {
    const html = await render(<Day8Estimates {...previewProps} />, {
      plainText: true,
      htmlToTextOptions: { wordwrap: false },
    });
    expect(html).toContain("price was 20% below what the new job actually cost him");
    expect(html).toContain("You can imagine how that went over.");
  });

  it("includes the kills-small-businesses couplet", async () => {
    const html = await render(<Day8Estimates {...previewProps} />, {
      plainText: true,
      htmlToTextOptions: { wordwrap: false },
    });
    expect(html).toContain("kind of thing that kills small businesses");
    expect(html).toContain("back-office is held together with copy-paste");
  });

  it("does NOT start with 'I want to tell you a story' (v3 cut)", async () => {
    const html = await render(<Day8Estimates {...previewProps} />, {
      plainText: true,
      htmlToTextOptions: { wordwrap: false },
    });
    expect(html).not.toContain("I want to tell you a story");
  });

  it("degrades when firstName is null", async () => {
    const html = await render(
      <Day8Estimates firstName={null} unsubscribeUrl="https://x.test" />,
      { plainText: true, htmlToTextOptions: { wordwrap: false } },
    );
    expect(html).toContain("Hey there,");
  });
});
