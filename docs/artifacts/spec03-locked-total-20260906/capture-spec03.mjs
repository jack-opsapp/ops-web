// Headless capture of the SPEC-03 locked-total control against the worktree dev server.
// Usage: node capture-spec03.mjs <outDir> <label> [tab...]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://localhost:3450";
const PROJECT = "8964fd86-d854-4b11-8284-db58043d4d19";
const [outDir, label, ...tabs] = process.argv.slice(2);
if (!outDir || !label) throw new Error("usage: capture-spec03.mjs <outDir> <label> [tab...]");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
await context.addCookies([{ name: "dev-bypass-user", value: "jackson", domain: "localhost", path: "/" }]);
const page = await context.newPage();
const consoleLines = [];
page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));

// First visit: the server gate bounces to /login; the client bypass then mints the operator token.
await page.goto(`${BASE}/admin/spec/${PROJECT}?tab=scope`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.cookie.includes("ops-auth-token="), null, { timeout: 60_000 });
await page.waitForTimeout(1500);

for (const tab of tabs.length ? tabs : ["scope"]) {
  await page.goto(`${BASE}/admin/spec/${PROJECT}?tab=${tab}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main:has-text('RIDGELINE ROOFING')", { timeout: 60_000 });
  await page.waitForTimeout(1200);
  const file = join(outDir, `${label}-${tab}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const text = await page.evaluate(() => document.querySelector("main")?.innerText ?? "");
  writeFileSync(join(outDir, `${label}-${tab}.txt`), `URL: ${BASE}/admin/spec/${PROJECT}?tab=${tab}\n\n${text}\n`);
  console.log("captured", file);
}
writeFileSync(join(outDir, `${label}-console.log`), consoleLines.join("\n") + "\n");
await browser.close();
