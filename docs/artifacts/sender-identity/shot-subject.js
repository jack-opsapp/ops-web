/**
 * Screenshot harness for the first-reply subject variables.
 *
 * Same arrangement as shot-run.js: the dev-bypass test company has no
 * connected mailbox, so the identity route is stubbed per state. The card,
 * the chips, the insertion and the example line are the real application —
 * 12 is captured AFTER clicking the {address} chip in the browser, so the
 * subject in that shot was produced by the shipped insertion code, and the
 * example line by the shipped fillSubjectTemplate.
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

  const BUILDER = {
    confirmedAt: null,
    providerSignature: null,
    effective: null,
    ops: null,
    missing: true,
    fields: FIELDS,
  };

  const STATES = {
    // The operator has typed up to the separator; the chip supplies the rest.
    insert: { ...BUILDER, outreachSubject: "Canpro Deck and Rail Estimate -" },
    plain: { ...BUILDER, outreachSubject: "Thanks for reaching out" },
    unfillable: { ...BUILDER, outreachSubject: "{company}" },
    confirmed: {
      confirmedAt: "2026-08-05T18:12:00.000Z",
      outreachSubject: "Canpro Deck and Rail Estimate - {address}",
      providerSignature: null,
      effective: null,
      ops: { html: CONFIRMED_HTML, text: CONFIRMED_TEXT },
      missing: false,
      fields: { ...FIELDS, includeLogo: true, layout: "logo-left" },
    },
  };

  let current = "insert";

  await page.route("**/api/integrations/email/signature**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    if (!/[?&]connectionId=/.test(request.url())) {
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

  async function open(state) {
    current = state;
    await page.goto(
      `http://localhost:3411/settings?section=profile&shot=subject-${state}`,
      { waitUntil: "domcontentloaded" }
    );
    const card = page.getByTestId("email-signature-settings").first();
    await card.waitFor({ state: "visible", timeout: 60000 });
    return card;
  }

  async function shoot(card, file) {
    await page.waitForTimeout(1200);
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `${OUT}/${file}` });
    const box = await card.boundingBox();
    results.push(
      `${file} :: ${Math.round(box.width)}x${Math.round(box.height)}`
    );
  }

  // 12 — the chip doing its job, in a real browser.
  let card = await open("insert");
  const subject = card.getByLabel("First reply subject");
  await subject.waitFor({ state: "visible", timeout: 60000 });
  await card.getByRole("button", { name: "{address}" }).click();
  await card.getByTestId("subject-example").waitFor({ state: "visible" });
  results.push(`inserted subject :: ${await subject.inputValue()}`);
  results.push(
    `example :: ${await card.getByTestId("subject-example").innerText()}`
  );
  await shoot(card, "12-subject-variable-inserted.png");

  // 13 — a plain subject explains itself; no example line at all.
  card = await open("plain");
  await card.getByLabel("First reply subject").waitFor({ state: "visible" });
  results.push(
    `plain example count :: ${await card.getByTestId("subject-example").count()}`
  );
  await shoot(card, "13-subject-plain-no-example.png");

  // 14 — nothing this lead can answer: the honest em dash, never a brace.
  card = await open("unfillable");
  await card.getByTestId("subject-example").waitFor({ state: "visible" });
  results.push(
    `unfillable example :: ${await card.getByTestId("subject-example").innerText()}`
  );
  await shoot(card, "14-subject-unfillable-example.png");

  // 15 — the stored template on the confirmed card, with what it resolves to.
  card = await open("confirmed");
  await card
    .getByRole("button", { name: "Edit identity" })
    .waitFor({ state: "visible", timeout: 60000 });
  results.push(
    `confirmed example :: ${await card.getByTestId("subject-example").innerText()}`
  );
  await shoot(card, "15-subject-confirmed-template.png");

  return results.join("\n");
}
