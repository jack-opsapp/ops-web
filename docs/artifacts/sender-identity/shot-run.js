/**
 * Screenshot harness for the sender-identity card.
 *
 * The dev-bypass test company has no connected mailbox, so the identity route
 * is stubbed. Component, tokens, fonts and layout are the real application;
 * only the API payload is fixture data.
 */
async (page) => {
  const OUT =
    "/Users/jacksonsweet/Projects/OPS/ops-web-sender-identity/docs/artifacts/sender-identity";
  const CONNECTION_ID = "5dd46f2b-a6b6-4a3d-9c5a-d660341f14a3";
  const MAILBOX = "jack@canprodeckandrail.com";
  const LOGO =
    "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/migrated/supabase-storage/images/uploads/1774301437179-lqy3se.png";

  const FIELDS = {
    name: "Jackson Sweet",
    title: "Owner",
    companyName: "Canpro Deck and Rail",
    phone: "(250) 538-8994",
    website: "canprodeckandrail.com",
    includeLogo: false,
    layout: "logo-left",
  };

  const CONFIRMED_HTML =
    '<table style="border-collapse:collapse"><tbody><tr>' +
    '<td style="vertical-align:middle;padding-right:14px;border-right:1px solid #6b6b6b">' +
    `<img src="${LOGO}" alt="Canpro Deck and Rail" width="96" /></td>` +
    '<td style="vertical-align:middle;padding-left:14px">' +
    '<div style="font-family:-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif;font-size:13px;line-height:1.5;color:#6b6b6b">' +
    '<div style="font-size:15px;font-weight:bold;color:#1a1a1a">Jackson Sweet</div>' +
    "<div>Owner · Canpro Deck and Rail</div>" +
    '<div>(250) 538-8994 · <a href="https://canprodeckandrail.com" rel="noopener noreferrer" style="color:#6b6b6b;text-decoration:none">canprodeckandrail.com</a></div>' +
    "</div></td></tr></tbody></table>";
  const CONFIRMED_TEXT =
    "Jackson Sweet\nOwner, Canpro Deck and Rail\n(250) 538-8994\ncanprodeckandrail.com";

  const STATES = {
    unconfigured: {
      confirmedAt: null,
      outreachSubject: null,
      providerSignature: null,
      effective: null,
      ops: null,
      missing: true,
      fields: FIELDS,
    },
    imported: {
      confirmedAt: null,
      outreachSubject: null,
      providerSignature: {
        source: "gmail",
        html: "<div>Jack<br>Canpro Deck and Rail<br>250-538-8994</div>",
        text: "Jack\nCanpro Deck and Rail\n250-538-8994",
        fetchedAt: "2026-08-04T18:00:00.000Z",
      },
      effective: null,
      ops: null,
      missing: false,
      fields: FIELDS,
    },
    confirmed: {
      confirmedAt: "2026-08-04T18:12:00.000Z",
      outreachSubject: "Canpro Deck and Rail estimate",
      providerSignature: null,
      effective: null,
      ops: { html: CONFIRMED_HTML, text: CONFIRMED_TEXT },
      missing: false,
      fields: { ...FIELDS, includeLogo: true, layout: "logo-left" },
    },
  };

  let current = "unconfigured";

  await page.route("**/api/integrations/email/signature**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    const requestUrl = request.url();
    if (!/[?&]connectionId=/.test(requestUrl)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          connections: [
            {
              id: CONNECTION_ID,
              mailbox: MAILBOX,
              provider: "gmail",
              type: "individual",
              identityConfirmed: current === "confirmed",
            },
          ],
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connectionId: CONNECTION_ID,
        mailbox: MAILBOX,
        provider: "gmail",
        providerImportSupported: true,
        companyLogoUrl: LOGO,
        ...STATES[current],
      }),
    });
  });

  const results = [];
  await page.setViewportSize({ width: 1440, height: 1000 });

  async function shoot(state, file, marker) {
    current = state;
    await page.goto(
      `http://localhost:3411/settings?section=profile&shot=${state}`,
      { waitUntil: "domcontentloaded" }
    );
    const card = page.getByTestId("email-signature-settings").first();
    await card.waitFor({ state: "visible", timeout: 45000 });
    // Wait for the state itself, not merely for a card — the render passes
    // through loading before the payload lands.
    await marker(card).waitFor({ state: "visible", timeout: 45000 });
    await page.waitForTimeout(1500);
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `${OUT}/${file}` });
    const box = await card.boundingBox();
    results.push(`${file} :: ${Math.round(box.width)}x${Math.round(box.height)}`);
  }

  await shoot("unconfigured", "01-unconfigured-builder.png", (card) =>
    card.getByLabel("Name")
  );
  await shoot("imported", "02-imported-awaiting-confirmation.png", (card) =>
    card.getByRole("button", { name: "Use this" })
  );
  await shoot("confirmed", "03-confirmed-compact.png", (card) =>
    card.getByRole("button", { name: "Edit identity" })
  );

  return results.join("\n");
}
