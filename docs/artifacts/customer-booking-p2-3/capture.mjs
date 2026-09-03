// Proof screenshots for the hosted guest booking flow (broker stubbed at the network layer).
import { chromium } from "@playwright/test";
import fs from "node:fs";

const base = process.env.BASE ?? "http://localhost:3691";
const H = process.env.HANDLE ?? "maverick-projects-ltd";
const out = process.env.OUT;
fs.mkdirSync(out, { recursive: true });

const TZ = "America/Denver";
const SLOTS = [
  "2027-09-07T15:00:00.000Z",
  "2027-09-07T16:00:00.000Z",
  "2027-09-07T17:00:00.000Z",
  "2027-09-07T19:00:00.000Z",
  "2027-09-07T20:00:00.000Z",
  "2027-09-08T15:00:00.000Z",
  "2027-09-08T17:00:00.000Z",
  "2027-09-09T16:00:00.000Z",
  "2027-09-10T15:00:00.000Z",
  "2027-09-13T15:00:00.000Z",
  "2027-09-14T17:00:00.000Z",
  "2027-09-15T15:00:00.000Z",
  "2027-09-16T16:00:00.000Z",
  "2027-09-17T15:00:00.000Z",
  "2027-09-20T15:00:00.000Z",
];

const json = (route, status, body) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const browser = await chromium.launch();
const errors = [];
const log = [];

async function newPage(viewport, opts = {}) {
  const { slots = SLOTS, mode, outcome = "confirmed", holdSeconds = 300, locale, gone = false } = opts;
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    ...(locale ? { locale, extraHTTPHeaders: { "Accept-Language": `${locale},es;q=0.9` } } : {}),
  });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.route("**/api/customer/booking/availability**", (r) =>
    gone
      ? // What the route answers for a business that has not turned booking on.
        json(r, 404, { error: "not_found" })
      : json(r, 200, {
      slots: slots.map((startAt, i) => ({ slot: `sl_${i}`, startAt })),
      timezone: TZ,
      durationMinutes: 60,
        ...(mode ? { mode } : {}),
      })
  );
  await page.route("**/api/customer/booking/hold", (r) =>
    json(r, 200, {
      intentRef: "in_demo",
      holdExpiresAt: new Date(Date.now() + holdSeconds * 1000).toISOString(),
    })
  );
  await page.route("**/api/customer/booking/contact", (r) =>
    json(r, 200, { challengeId: "ch_demo", retryAfterSeconds: 60 })
  );
  await page.route("**/api/customer/booking/verify", (r) =>
    json(r, 200, { outcome, bookingRef: outcome === "confirmed" ? "bk_7Q2M" : undefined })
  );
  return { ctx, page };
}

async function toDetails(page) {
  await page.locator("[data-booking-step='time']").waitFor();
  await page.locator("[data-slot-time]").first().click();
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.locator("[data-booking-step='details']").waitFor();
}

async function toCode(page) {
  await page.getByLabel(/^name$/i).fill("Jordan Lee");
  await page.getByLabel(/^email$/i).fill("jordan@example.com");
  await page.getByLabel(/phone/i).fill("403-555-0199");
  await page.getByRole("button", { name: /send code/i }).click();
  await page.locator("[data-booking-step='code']").waitFor();
}

/** Full walk: the three steps, then the ending. */
async function flow(tag, viewport, opts = {}) {
  const { ctx, page } = await newPage(viewport, opts);
  await page.goto(`${base}/c/${H}/book`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.locator("[data-booking-step='time']").waitFor({ timeout: 120000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/booking-01-time-${tag}.png` });
  log.push(`${tag} step 1: ${(await page.locator("main").innerText()).replace(/\n+/g, " | ")}`);

  await toDetails(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/booking-02-details-${tag}.png` });

  await toCode(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/booking-03-code-${tag}.png` });

  for (let i = 0; i < 6; i++) await page.getByLabel(`Digit ${i + 1} of 6`).fill("123456"[i]);
  await page.locator("[data-booking-outcome]").waitFor();
  await page.waitForTimeout(400);
  const outcome = await page.locator("[data-booking-outcome]").getAttribute("data-booking-outcome");
  await page.screenshot({ path: `${out}/booking-04-${outcome}-${tag}.png` });
  log.push(`${tag} ending[${outcome}]: ${(await page.locator("main").innerText()).replace(/\n+/g, " | ")}`);
  await ctx.close();
}

await flow("mobile", { width: 390, height: 844 });
await flow("desktop", { width: 1440, height: 900 });
await flow("request-mobile", { width: 390, height: 844 }, { mode: "request", outcome: "submitted" });
await flow("request-desktop", { width: 1440, height: 900 }, { mode: "request", outcome: "submitted" });

{
  // Sold out - or booking simply off. One page for both (enumeration-safe).
  const { ctx, page } = await newPage({ width: 390, height: 844 }, { slots: [] });
  await page.goto(`${base}/c/${H}/book`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.locator("[data-booking-step='empty']").waitFor({ timeout: 120000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/booking-05-sold-out-mobile.png` });
  log.push(`sold out: ${(await page.locator("main").innerText()).replace(/\n+/g, " | ")}`);
  await ctx.close();
}

{
  // The hold runs out mid-details: back to step one, typing kept.
  const { ctx, page } = await newPage({ width: 390, height: 844 }, { holdSeconds: 4 });
  await page.goto(`${base}/c/${H}/book`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await toDetails(page);
  await page.getByLabel(/^name$/i).fill("Jordan Lee");
  await page.getByLabel(/^email$/i).fill("jordan@example.com");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/booking-06-hold-expiring-mobile.png` });
  await page.locator("[data-booking-step='time']").waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/booking-07-hold-expired-mobile.png` });
  log.push(`hold expired: ${(await page.locator("main").innerText()).replace(/\n+/g, " | ")}`);
  await ctx.close();
}

{
  // Every day the business publishes, behind one quiet disclosure.
  const { ctx, page } = await newPage({ width: 390, height: 844 });
  await page.goto(`${base}/c/${H}/book`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.locator("[data-booking-step='time']").waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: /show more days/i }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/booking-08-more-days-mobile.png` });
  log.push(`days shown after disclosure: ${await page.locator("[data-day]").count()}`);
  await ctx.close();
}

{
  // Booking switched off: indistinguishable from a link that never existed.
  const { ctx, page } = await newPage({ width: 390, height: 844 }, { gone: true });
  await page.goto(`${base}/c/${H}/book`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.locator("[data-booking-step='gone']").waitFor({ timeout: 120000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/booking-10-booking-off-mobile.png` });
  log.push(`booking off: ${(await page.locator("main").innerText()).replace(/\n+/g, " | ")}`);
  await ctx.close();
}

{
  // Spanish via Accept-Language.
  const { ctx, page } = await newPage({ width: 390, height: 844 }, { locale: "es-MX" });
  await page.goto(`${base}/c/${H}/book`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.locator("[data-booking-step='time']").waitFor({ timeout: 120000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/booking-09-time-mobile-es.png` });
  log.push(`es step 1: ${(await page.locator("main").innerText()).replace(/\n+/g, " | ")}`);
  await ctx.close();
}

await browser.close();
console.log(log.join("\n"));
console.log(`console/page errors: ${errors.length}`);
for (const e of errors) console.log("  " + e);
