// Proof screenshots for the hosted customer sign-in shell (broker stubbed at the network layer).
import { chromium } from "@playwright/test";
import fs from "node:fs";

const base = process.env.BASE ?? "http://localhost:3640";
const H = process.env.HANDLE ?? "maverick-projects-ltd";
const out = process.env.OUT;
fs.mkdirSync(out, { recursive: true });

const json = (route, status, body) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const browser = await chromium.launch();
const errors = [];
const log = [];

async function newPage(viewport, membership = "active_forward_only") {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/customer/auth/start", (r) => json(r, 200, { challengeId: "ch_demo", retryAfterSeconds: 60 }));
  await page.route("**/api/customer/auth/verify", (r) => {
    const b = r.request().postDataJSON();
    return b.code === "123456" ? json(r, 200, { ok: true, next: `/c/${H}/home` }) : json(r, 400, { error: "invalid_code" });
  });
  await page.route("**/api/customer/me**", (r) => json(r, 200, { displayName: "Jordan Lee", maskedEmail: "j•••@example.com", membership: { state: membership } }));
  await page.route("**/api/customer/auth/signout", (r) => json(r, 204, {}));
  return { ctx, page };
}

async function flow(tag, viewport) {
  const { ctx, page } = await newPage(viewport);
  await page.goto(`${base}/c/${H}/signin`, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/customer-signin-01-email-${tag}.png` });

  await page.getByLabel(/^email$/i).fill("jordan@example.com");
  await page.getByRole("button", { name: /send code/i }).click();
  await page.getByRole("heading", { level: 1 }).filter({ hasText: /enter code/i }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/customer-signin-02-code-${tag}.png` });

  for (let i = 0; i < 6; i++) await page.getByLabel(`Digit ${i + 1} of 6`).fill("1");
  await page.locator("main").getByRole("alert").waitFor();
  await page.waitForTimeout(300);
  log.push(`${tag} error copy: ${await page.locator("main").getByRole("alert").innerText()}`);
  await page.screenshot({ path: `${out}/customer-signin-03-code-error-${tag}.png` });

  for (let i = 0; i < 6; i++) await page.getByLabel(`Digit ${i + 1} of 6`).fill("123456"[i]);
  await page.waitForURL(`**/c/${H}/home`, { timeout: 120000 });
  await page.locator("[data-membership-view='forward_only']").waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/customer-home-forward-only-${tag}.png` });
  log.push(`${tag} home: ${(await page.locator("main").innerText()).replace(/\n+/g, " | ")}`);
  await ctx.close();
}

await flow("desktop", { width: 1440, height: 900 });
await flow("mobile", { width: 390, height: 844 });

for (const state of ["active_full", "none"]) {
  const { ctx, page } = await newPage({ width: 390, height: 844 }, state);
  await page.goto(`${base}/c/${H}/home`, { waitUntil: "networkidle", timeout: 180000 });
  await page.locator("[data-membership-view]").waitFor();
  await page.waitForTimeout(400);
  const view = await page.locator("[data-membership-view]").getAttribute("data-membership-view");
  await page.screenshot({ path: `${out}/customer-home-${view}-mobile.png` });
  log.push(`home[${state}] → view=${view}: ${(await page.locator("main").innerText()).replace(/\n+/g, " | ")}`);
  await ctx.close();
}

{
  const { ctx, page } = await newPage({ width: 390, height: 844 });
  const resp = await page.goto(`${base}/c/no-such-business-zz/signin`, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/customer-not-found-mobile.png` });
  log.push(`not-found status ${resp.status()}: ${await page.locator("h1").innerText()}`);
  await ctx.close();
}

{
  // Spanish via Accept-Language
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-MX", extraHTTPHeaders: { "Accept-Language": "es-MX,es;q=0.9" } });
  const page = await ctx.newPage();
  await page.goto(`${base}/c/${H}/signin`, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/customer-signin-01-email-mobile-es.png` });
  log.push(`es h1: ${await page.locator("h1").innerText()}`);
  await ctx.close();
}

await browser.close();
console.log(log.join("\n"));
console.log(`console/page errors: ${errors.length}`);
for (const e of errors) console.log("  " + e);
