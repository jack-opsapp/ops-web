// Evidence screenshot for the readiness ledger (1440×900, dark).
//
// The admin layout admits only the `admins` table (Jackson's two accounts) and
// the dev auth bypass has no admin identity, so the real /admin/google-ads
// route cannot be captured locally. This renders the SAME component with the
// SAME page chrome on a throwaway dev route (src/app/dev-readiness-ledger,
// never committed) and serves it the stored server-side probe payload
// (readiness-probe.json — the real production readiness at 04:21 UTC).
//
// Usage: node docs/artifacts/ads-engine/p1/capture-readiness-ledger.mjs [port]
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const port = process.argv[2] ?? "3210";
const out = "docs/artifacts/ads-engine/p1/readiness-ledger.png";
const payload = readFileSync("docs/artifacts/ads-engine/p1/readiness-probe.json", "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
await page.route("**/api/admin/google-ads/readiness", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: payload })
);
try {
  await page.goto(`http://localhost:${port}/dashboard`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.waitForTimeout(3_000);
  await page.goto(`http://localhost:${port}/dev-readiness-ledger`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.waitForSelector('section[aria-label="Engine readiness"] li', { timeout: 120_000 });
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: out, fullPage: false });
  const rows = await page.$$eval('section[aria-label="Engine readiness"] li', (els) =>
    els.map((el) => `${el.getAttribute("data-state")} · ${el.querySelector("[data-row-title]")?.textContent} · ${el.querySelector("[data-row-reason]")?.textContent}`)
  );
  console.log(JSON.stringify({ url: page.url(), rows }, null, 1));
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
