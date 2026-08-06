/**
 * Screenshot harness for the custom signature logo (workstream C).
 *
 * Same arrangement as `shot-run.js`: the dev-bypass company has no connected
 * mailbox, so `GET/POST /api/integrations/email/signature` is stubbed with
 * payloads shaped exactly like the route's real responses. Everything else is
 * the running application — including the background removal, which executes
 * for real in the browser against a real PNG fed through the real file input.
 *
 * Emits, alongside the screenshots: the source image and the bytes the card
 * actually uploaded, so the cut can be inspected rather than taken on faith.
 */
async (page) => {
  const OUT =
    "/Users/jacksonsweet/Projects/OPS/ops-web-sender-identity/docs/artifacts/sender-identity";
  const CONNECTION_ID = "5dd46f2b-a6b6-4a3d-9c5a-d660341f14a3";
  const MAILBOX = "jack@canprodeckandrail.com";
  const COMPANY_LOGO =
    "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/migrated/supabase-storage/images/uploads/1774301437179-lqy3se.png";
  const CUSTOM_LOGO =
    "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/email-signatures/a612edc0-5c18-4c4d-af97-55b9410dd077/1775420000000-shotmark.png";

  const FIELDS = {
    name: "Jackson Sweet",
    title: "Owner",
    companyName: "Canpro Deck and Rail",
    phone: "(250) 538-8994",
    website: "canprodeckandrail.com",
    includeLogo: true,
    layout: "logo-left",
  };

  // Byte-for-byte what `renderSignatureTemplate` produces for these fields
  // with the uploaded mark — the card only draws the sheet when the stored row
  // and the live render agree exactly.
  const CONFIRMED_HTML =
    '<table style="border-collapse:collapse"><tbody><tr>' +
    '<td style="vertical-align:middle;padding-right:14px;border-right:1px solid #6b6b6b">' +
    `<img src="${CUSTOM_LOGO}" alt="Canpro Deck and Rail" width="96" /></td>` +
    '<td style="vertical-align:middle;padding-left:14px">' +
    '<div style="font-family:-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif;font-size:13px;line-height:1.5;color:#6b6b6b">' +
    '<div style="font-size:15px;font-weight:bold;color:#1a1a1a">Jackson Sweet</div>' +
    "<div>Owner · Canpro Deck and Rail</div>" +
    '<div>(250) 538-8994 · <a href="https://canprodeckandrail.com" rel="noopener noreferrer" style="color:#6b6b6b;text-decoration:none">canprodeckandrail.com</a></div>' +
    "</div></td></tr></tbody></table>";
  const CONFIRMED_TEXT =
    "Jackson Sweet\nOwner, Canpro Deck and Rail\n(250) 538-8994\ncanprodeckandrail.com";

  const state = {
    confirmedAt: null,
    outreachSubject: "Canpro Deck and Rail estimate",
    providerSignature: null,
    effective: null,
    ops: null,
    missing: true,
    signatureLogoUrl: null,
    fields: FIELDS,
  };

  /** Bytes the card uploaded — the cut image, straight off the wire. */
  let uploaded = null;

  /** Swapped between shots to reach the has-no-mark-at-all state. */
  let companyLogo = COMPANY_LOGO;

  const settings = () => ({
    connectionId: CONNECTION_ID,
    mailbox: MAILBOX,
    provider: "gmail",
    providerImportSupported: true,
    companyLogoUrl: companyLogo,
    ...state,
  });

  await page.route("**/api/integrations/email/signature**", async (route) => {
    const request = route.request();
    const url = request.url();

    if (request.method() === "PUT") {
      // Saving IS confirming — the stub answers the way the route does.
      const body = request.postDataJSON() ?? {};
      if (body.fields) {
        state.confirmedAt = "2026-08-05T18:00:00.000Z";
        state.missing = false;
        state.ops = { html: CONFIRMED_HTML, text: CONFIRMED_TEXT };
      }
      if (typeof body.outreachSubject === "string") {
        state.outreachSubject = body.outreachSubject.trim() || null;
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(settings()),
      });
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON() ?? {};
      if (body.action === "upload_signature_logo") {
        uploaded = String(body.data);
        state.signatureLogoUrl = CUSTOM_LOGO;
      }
      if (body.action === "clear_signature_logo") state.signatureLogoUrl = null;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(settings()),
      });
    }
    if (request.method() !== "GET") return route.fallback();

    if (!/[?&]connectionId=/.test(url)) {
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
              identityConfirmed: Boolean(state.confirmedAt),
            },
          ],
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(settings()),
    });
  });

  // The stored object lives in the OPS bucket in production; here it is served
  // back as the exact bytes the browser just cut, so the thumbnail and the
  // preview show the real result rather than a stand-in.
  await page.route(CUSTOM_LOGO, async (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      path: `${OUT}/logo-cut-transparent.png`,
    })
  );

  const results = [];
  await page.setViewportSize({ width: 1440, height: 1000 });

  async function open() {
    // Cold webpack compiles on this route run into minutes, and the dev
    // bypass signs in through /login before landing back here.
    page.setDefaultNavigationTimeout(300000);
    page.setDefaultTimeout(120000);
    await page.goto("http://localhost:3411/settings?section=profile", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForURL(/\/settings/, { timeout: 300000 });
    const card = page.getByTestId("email-signature-settings").first();
    await card.waitFor({ state: "visible", timeout: 60000 });
    await card.getByLabel("Name").waitFor({ state: "visible", timeout: 60000 });
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

  // Nothing on the company record and nothing uploaded: one way in, no
  // toggle and no arrangement to reason about yet.
  companyLogo = null;
  let card = await open();
  await shoot(card, "07-no-logo-add.png");

  companyLogo = COMPANY_LOGO;
  card = await open();
  await shoot(card, "08-company-logo-source-actions.png");

  // The same file `make-logo-fixture.ts` builds: a real PNG logo sitting on a
  // solid white field, anti-aliased edges and all.
  await page
    .locator('[data-testid="signature-logo-input"]')
    .setInputFiles(`${OUT}/logo-source-white-bg.png`);

  await card
    .getByText("[background removed]")
    .waitFor({ state: "visible", timeout: 30000 });
  await shoot(card, "09-background-removed-undo.png");

  if (!uploaded) throw new Error("nothing was uploaded");
  // Decode what the browser actually sent, so the cut is measured rather than
  // assumed to match the Node-side fixture.
  const cutPixels = await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "image/png" });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const c = canvas.getContext("2d");
    c.drawImage(bitmap, 0, 0);
    const { data } = c.getImageData(0, 0, bitmap.width, bitmap.height);
    let clear = 0;
    let feathered = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) clear += 1;
      else if (data[i] < 255) feathered += 1;
    }
    return {
      width: bitmap.width,
      height: bitmap.height,
      total: data.length / 4,
      clear,
      feathered,
      cornerAlpha: data[3],
      markAlpha: data[(78 * bitmap.width + 200) * 4 + 3],
      counterAlpha: data[(100 * bitmap.width + 80) * 4 + 3],
    };
  }, uploaded);
  results.push(`browser cut ${JSON.stringify(cutPixels)}`);

  // Confirmed, signing with the operator's own mark. The save goes through the
  // card's own action, not a state poke, so the compact view is the one the
  // operator actually lands on.
  card = page.getByTestId("email-signature-settings").first();
  await page.getByRole("button", { name: "Confirm identity" }).first().click();
  await card
    .getByRole("button", { name: "Edit identity" })
    .waitFor({ state: "visible", timeout: 30000 });
  await shoot(card, "10-custom-logo-confirmed.png");

  return results.join("\n");
}
