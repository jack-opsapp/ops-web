/**
 * Post-connect step, entered through the OAuth callback's real return URL
 * (`?tab=integrations&status=connected`, which the shell canonicalizes to
 * `?section=email`). Identity route stubbed; everything else is the app.
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
          title: "",
          companyName: "Canpro Deck and Rail",
          phone: "(250) 538-8994",
          website: "canprodeckandrail.com",
          includeLogo: false,
          layout: "logo-left",
        },
      }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    "http://localhost:3411/settings?tab=integrations&status=connected",
    { waitUntil: "domcontentloaded" }
  );

  const step = page.getByTestId("sender-identity-connect-step");
  await step.waitFor({ state: "visible", timeout: 45000 });
  await page.getByLabel("Name").first().waitFor({ state: "visible" });
  await page.waitForTimeout(1500);
  await step.screenshot({ path: `${OUT}/04-post-connect-step.png` });

  const box = await step.boundingBox();
  return `04-post-connect-step.png :: ${Math.round(box.width)}x${Math.round(box.height)} :: url=${page.url()}`;
}
