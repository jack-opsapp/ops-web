// Headless capture of the Google Ads engine console on the rehearsal server.
// Usage: node capture.mjs <step>   (step: proposals | approve-negatives | approve-challenger | note-observation | funnel)
// Screenshots land in ./screenshots; page text in ./screenshots/<step>.txt.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const base = "http://localhost:3225";
const here = new URL(".", import.meta.url).pathname;
const out = `${here}screenshots`;
mkdirSync(out, { recursive: true });
const step = process.argv[2] ?? "proposals";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", deviceScaleFactor: 2 });
await context.addCookies([{ name: "dev-bypass-user", value: "pete", domain: "localhost", path: "/" }]);
const page = await context.newPage();
page.setDefaultTimeout(120_000);

async function signIn() {
  page.on("console", (m) => { if (m.type() === "error") console.log("console.error:", m.text().slice(0, 300)); });
  try {
    await page.goto(`${base}/admin/google-ads`, { waitUntil: "domcontentloaded" });
    console.log("after first goto:", page.url());
    await page.waitForFunction(() => document.cookie.includes("ops-auth-token="), null, { timeout: 90_000 });
    console.log("auth cookie present:", page.url());
    await page.goto(`${base}/admin/google-ads`, { waitUntil: "networkidle" });
    console.log("after second goto:", page.url());
    await page.getByText("// PROPOSALS").first().waitFor({ state: "visible", timeout: 90_000 });
    await page.waitForTimeout(1500);
  } catch (error) {
    await page.screenshot({ path: `${out}/debug-signin.png`, fullPage: true });
    writeFileSync(`${out}/debug-signin.txt`, `${page.url()}\n\n${await page.locator("body").innerText()}`);
    throw error;
  }
}

async function snap(name, anchor = "// PROPOSALS") {
  await page.getByText(anchor, { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -24));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  writeFileSync(`${out}/${name}.txt`, await page.locator("body").innerText());
  console.log(`wrote ${name}.png`);
}

/** Click the primary button on the first card whose text contains `needle`, then wait for the network to settle. */
async function actOnCard(needle, button) {
  const card = page.locator(`article[data-testid="proposal-card"][data-kind="${needle}"]`).first();
  await card.scrollIntoViewIfNeeded();
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/admin/google-ads/engine/proposals/") && r.request().method() === "POST", { timeout: 120_000 }),
    card.getByRole("button", { name: button, exact: true }).first().click(),
  ]);
  const body = await response.text();
  console.log(`${button} on "${needle}" → ${response.status()} ${body.slice(0, 400)}`);
  await card.getByText(/^(APPLIED|FAILED|VALIDATED · REHEARSAL|REJECTED|QUEUED)/).first().waitFor({ state: "visible", timeout: 90_000 });
  await page.waitForTimeout(1500);
  return body;
}

await signIn();
if (step === "proposals") {
  await snap("01-proposals-waiting");
} else if (step === "note-observation") {
  const body = await actOnCard("observation", "NOTED");
  writeFileSync(`${out}/02-observation-noted.json`, body);
  await snap("02-observation-noted");
} else if (step === "approve-challenger") {
  const body = await actOnCard("create_rsa_challenger", "APPROVE");
  writeFileSync(`${out}/03-challenger-approved-validateonly.json`, body);
  await snap("03-challenger-approved-validateonly");
} else if (step === "approve-negatives") {
  const body = await actOnCard("add_negatives", "APPROVE");
  writeFileSync(`${out}/04-negatives-approved.json`, body);
  await snap("04-negatives-approved");
} else if (step === "funnel") {
  for (const [name, label] of [["05-funnel", "engine-funnel-label"], ["06-tests", "engine-tests-label"], ["07-engine-health", "engine-health-label"], ["08-change-ledger", "engine-ledger-label"]]) {
    const section = page.locator(`section[aria-labelledby="${label}"]`).first();
    await section.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(600);
    await section.screenshot({ path: `${out}/${name}.png` });
    writeFileSync(`${out}/${name}.txt`, await section.innerText());
    console.log(`wrote ${name}.png`);
  }
} else {
  throw new Error(`unknown step ${step}`);
}
await browser.close();
