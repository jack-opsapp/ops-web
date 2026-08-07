/**
 * The logo arrangement control — visible only once the logo is switched on.
 * Identity route stubbed; component, tokens and layout are the real app.
 */
async (page) => {
  const OUT =
    "/Users/jacksonsweet/Projects/OPS/ops-web-sender-identity/docs/artifacts/sender-identity";
  const CONNECTION_ID = "5dd46f2b-a6b6-4a3d-9c5a-d660341f14a3";
  const MAILBOX = "jack@canprodeckandrail.com";
  const LOGO =
    "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/migrated/supabase-storage/images/uploads/1774301437179-lqy3se.png";

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
              identityConfirmed: false,
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
        confirmedAt: null,
        outreachSubject: null,
        providerSignature: null,
        effective: null,
        ops: null,
        missing: true,
        fields: {
          name: "Jackson Sweet",
          title: "Owner",
          companyName: "Canpro Deck and Rail",
          phone: "(250) 538-8994",
          website: "canprodeckandrail.com",
          includeLogo: false,
          layout: "logo-left",
        },
      }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("http://localhost:3411/settings?section=profile&shot=layout", {
    waitUntil: "domcontentloaded",
  });

  const card = page.getByTestId("email-signature-settings").first();
  await card.waitFor({ state: "visible", timeout: 45000 });
  await card.getByLabel("Name").waitFor({ state: "visible" });

  const results = [];
  await card.getByRole("switch", { name: "Show company logo" }).click();
  await card
    .getByRole("radio", { name: "Logo left" })
    .waitFor({ state: "visible" });
  await page.waitForTimeout(1500);
  await card.screenshot({ path: `${OUT}/05-logo-left-default.png` });
  results.push("05-logo-left-default.png");

  await card.getByRole("radio", { name: "Logo below" }).click();
  await page.waitForTimeout(1200);
  await card.screenshot({ path: `${OUT}/06-logo-below.png` });
  results.push("06-logo-below.png");

  const box = await card.boundingBox();
  return `${results.join(", ")} :: card ${Math.round(box.width)}x${Math.round(box.height)}`;
}
