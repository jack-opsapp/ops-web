import { describe, expect, it } from "vitest";

import { sanitizeEmailSignatureHtml } from "@/lib/api/services/email-signature-service";
import { renderSignatureTemplate } from "@/lib/email/signature-template";

const FULL = {
  name: "Jackson Sweet",
  title: "Owner",
  companyName: "Canpro Deck and Rail",
  phone: "(250) 538-8994",
  website: "https://canprodeckandrail.com",
  logoUrl: "https://cdn.example.com/canpro-logo.png",
};

describe("renderSignatureTemplate", () => {
  it("puts the logo in a left cell with a hairline divider by default", () => {
    const { html } = renderSignatureTemplate(FULL);

    expect(html).toContain("<table");
    expect(html).toContain("border-right");
    expect(html).toContain('<img src="https://cdn.example.com/canpro-logo.png"');
    expect(html).toContain('width="96"');
    expect(html).toContain('alt="Canpro Deck and Rail"');
    // Business-card arrangement: the logo cell precedes the text block.
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("Jackson Sweet"));
    expect(html).toContain("Jackson Sweet");
    expect(html).toContain("Owner");
    expect(html).toContain("Canpro Deck and Rail");
    expect(html).toContain("(250) 538-8994");
    expect(html).toContain("canprodeckandrail.com");
  });

  it("renders the stacked arrangement with the logo beneath the text", () => {
    const { html } = renderSignatureTemplate({ ...FULL, layout: "stacked" });

    expect(html).not.toContain("<table");
    expect(html).not.toContain("border-right");
    expect(html).toContain('width="120"');
    expect(html.indexOf("Jackson Sweet")).toBeLessThan(html.indexOf("<img"));
  });

  it("renders name and company alone when nothing else is supplied", () => {
    const { html, text } = renderSignatureTemplate({
      name: "Jackson Sweet",
      companyName: "Canpro Deck and Rail",
    });

    expect(html).toContain("Jackson Sweet");
    expect(html).toContain("Canpro Deck and Rail");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("·");
    expect(text).toBe("Jackson Sweet\nCanpro Deck and Rail");
  });

  it("falls back to the stacked arrangement when there is no logo", () => {
    const { html } = renderSignatureTemplate({
      ...FULL,
      logoUrl: null,
      layout: "logo-left",
    });

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("border-right");
    expect(html).not.toContain("vertical-align");
  });

  it("ignores a logo URL that is not an http(s) address", () => {
    const { html } = renderSignatureTemplate({
      ...FULL,
      logoUrl: "javascript:alert(1)",
    });

    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript");
  });

  it("escapes operator-supplied field values", () => {
    const { html, text } = renderSignatureTemplate({
      name: 'Jack "The Deck" <Sweet>',
      companyName: "Deck & Rail",
    });

    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;Sweet&gt;");
    expect(html).not.toContain("<Sweet>");
    expect(text).toContain('Jack "The Deck" <Sweet>');
    expect(text).toContain("Deck & Rail");
  });

  it("mirrors the fields as plain text, one line per fact", () => {
    const { text } = renderSignatureTemplate(FULL);

    expect(text).toBe(
      [
        "Jackson Sweet",
        "Owner, Canpro Deck and Rail",
        "(250) 538-8994",
        "canprodeckandrail.com",
      ].join("\n")
    );
  });

  it("keeps the plain-text mirror identical across both arrangements", () => {
    expect(renderSignatureTemplate({ ...FULL, layout: "stacked" }).text).toBe(
      renderSignatureTemplate({ ...FULL, layout: "logo-left" }).text
    );
  });

  it("survives the outbound sanitizer unchanged — logo-left", () => {
    const { html } = renderSignatureTemplate({ ...FULL, layout: "logo-left" });

    expect(sanitizeEmailSignatureHtml(html)).toBe(html);
  });

  it("survives the outbound sanitizer unchanged — stacked", () => {
    const { html } = renderSignatureTemplate({ ...FULL, layout: "stacked" });

    expect(sanitizeEmailSignatureHtml(html)).toBe(html);
  });

  it("survives the outbound sanitizer unchanged — minimal fields", () => {
    const { html } = renderSignatureTemplate({
      name: "Jackson Sweet",
      companyName: "Canpro Deck and Rail",
    });

    expect(sanitizeEmailSignatureHtml(html)).toBe(html);
  });
});
