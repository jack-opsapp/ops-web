import { describe, expect, it } from "vitest";

import { sanitizeEmailSignatureHtml } from "@/lib/api/services/email-signature-service";
import {
  describeSignatureTemplate,
  renderSignatureTemplate,
} from "@/lib/email/signature-template";

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

describe("describeSignatureTemplate", () => {
  function roundTrip(fields: Parameters<typeof renderSignatureTemplate>[0]) {
    const rendered = renderSignatureTemplate(fields);
    return describeSignatureTemplate({
      ...rendered,
      companyName: fields.companyName,
    });
  }

  it("recovers every field the operator typed", () => {
    expect(roundTrip(FULL)).toEqual({
      name: "Jackson Sweet",
      title: "Owner",
      phone: "(250) 538-8994",
      website: "canprodeckandrail.com",
      includeLogo: true,
      layout: "logo-left",
    });
  });

  it("recovers the stacked arrangement", () => {
    expect(roundTrip({ ...FULL, layout: "stacked" })).toMatchObject({
      includeLogo: true,
      layout: "stacked",
    });
  });

  it("recovers a company name that itself contains a comma", () => {
    expect(
      roundTrip({
        name: "Jackson Sweet",
        title: "Owner",
        companyName: "Canpro Deck and Rail, Inc.",
      })
    ).toMatchObject({ title: "Owner" });
  });

  it("reads no title when the operator left it blank", () => {
    expect(roundTrip({ name: "Jackson Sweet", companyName: "Canpro" })).toEqual({
      name: "Jackson Sweet",
      title: "",
      phone: "",
      website: "",
      includeLogo: false,
      layout: "logo-left",
    });
  });

  it("returns nothing recoverable from a signature it did not render", () => {
    expect(
      describeSignatureTemplate({
        html: "<div>Jackson<br>OPS</div>",
        text: "Jackson\nOPS",
        companyName: "Canpro Deck and Rail",
      })
    ).toBeNull();
  });
});

/**
 * The settings card decides whether to draw the stored signature as a card by
 * re-rendering what it read back and comparing byte for byte — so a render the
 * describe cannot reproduce exactly shows the operator a text block where their
 * business card should be. These walk the real server→client path: save, read
 * back, re-render the way the card does.
 */
describe("render → describe → render", () => {
  const COMPANY_LOGO = "https://cdn.example.com/company-logo.png";
  const SIGNATURE_LOGO = "https://cdn.example.com/signature-mark.png";

  /** Exactly what `loadResponse` + the settings card do, in that order. */
  function reRender(
    fields: Parameters<typeof renderSignatureTemplate>[0],
    logos: { signatureLogoUrl: string | null; companyLogoUrl: string | null }
  ) {
    const stored = renderSignatureTemplate(fields);
    const described = describeSignatureTemplate({
      ...stored,
      companyName: fields.companyName,
    });
    expect(described).not.toBeNull();

    // The card renders the fields the route handed back, against the mark the
    // mailbox carries today — never the URL baked into the stored markup.
    const effectiveLogo = logos.signatureLogoUrl ?? logos.companyLogoUrl;
    return {
      stored,
      described: described!,
      rebuilt: renderSignatureTemplate({
        name: described!.name,
        title: described!.title,
        companyName: fields.companyName,
        phone: described!.phone,
        website: described!.website,
        logoUrl: described!.includeLogo ? effectiveLogo : null,
        layout: described!.layout,
      }),
    };
  }

  it("reproduces a website carrying its scheme and a trailing slash", () => {
    // The company record supplies the website, and a company record holds a
    // pasted address: scheme, www, trailing slash. The stored href keeps it;
    // the label on the card does not.
    const { stored, rebuilt } = reRender(
      {
        name: "Jackson Sweet",
        title: "",
        companyName: "Canpro Deck and Rail",
        phone: "(250) 538-8994",
        website: "https://www.canprodeckandrail.com/",
        logoUrl: SIGNATURE_LOGO,
        layout: "logo-left",
      },
      { signatureLogoUrl: SIGNATURE_LOGO, companyLogoUrl: COMPANY_LOGO }
    );

    expect(rebuilt.html).toBe(stored.html);
  });

  it("reproduces an http-only address rather than upgrading it", () => {
    const { stored, rebuilt } = reRender(
      {
        name: "Jackson Sweet",
        companyName: "Canpro Deck and Rail",
        website: "http://canprodeckandrail.com",
      },
      { signatureLogoUrl: null, companyLogoUrl: null }
    );

    expect(rebuilt.html).toBe(stored.html);
    expect(stored.html).toContain('href="http://canprodeckandrail.com"');
  });

  it("still tells the phone from the website when both are present", () => {
    const { described } = reRender(
      {
        name: "Jackson Sweet",
        companyName: "Canpro Deck and Rail",
        phone: "(250) 538-8994",
        website: "https://www.canprodeckandrail.com/",
      },
      { signatureLogoUrl: null, companyLogoUrl: null }
    );

    expect(described.phone).toBe("(250) 538-8994");
  });

  it("reads no phone from a signature that carries only a website", () => {
    const { described } = reRender(
      {
        name: "Jackson Sweet",
        companyName: "Canpro Deck and Rail",
        website: "https://www.canprodeckandrail.com/",
      },
      { signatureLogoUrl: null, companyLogoUrl: null }
    );

    expect(described.phone).toBe("");
  });

  it("keeps the address in its business-card form when that is faithful", () => {
    // Nothing about `canprodeckandrail.com` needs a scheme to render the same
    // link, so the builder reopens on the address the operator typed.
    const { described, stored, rebuilt } = reRender(
      {
        name: "Jackson Sweet",
        companyName: "Canpro Deck and Rail",
        website: "canprodeckandrail.com",
      },
      { signatureLogoUrl: null, companyLogoUrl: null }
    );

    expect(described.website).toBe("canprodeckandrail.com");
    expect(rebuilt.html).toBe(stored.html);
  });

  it("reproduces every arrangement and field combination", () => {
    const websites = [
      "",
      "canprodeckandrail.com",
      "www.canprodeckandrail.com",
      "https://canprodeckandrail.com",
      "https://www.canprodeckandrail.com/",
      "http://canprodeckandrail.com/",
      "HTTPS://Canprodeckandrail.com/",
      "canprodeckandrail.com/decks",
    ];

    for (const website of websites) {
      for (const layout of ["logo-left", "stacked"] as const) {
        for (const title of ["", "Owner"]) {
          for (const phone of ["", "(250) 538-8994"]) {
            const { stored, rebuilt } = reRender(
              {
                name: "Jackson Sweet",
                title,
                companyName: "Canpro Deck and Rail",
                phone,
                website,
                logoUrl: SIGNATURE_LOGO,
                layout,
              },
              { signatureLogoUrl: SIGNATURE_LOGO, companyLogoUrl: COMPANY_LOGO }
            );

            expect(
              rebuilt.html,
              `website=${website} layout=${layout} title=${title} phone=${phone}`
            ).toBe(stored.html);
          }
        }
      }
    }
  });
});
