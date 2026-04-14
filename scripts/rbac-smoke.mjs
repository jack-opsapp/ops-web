// RBAC smoke test — launches a fresh headless chromium, logs in as Nick
// Bradshaw (Crew role in Pete's company), exercises the pages affected by
// the RBAC audit, and reports counts + console errors.

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const EMAIL = "nickybradshaw1989@outlook.com";
const PASSWORD = "Poopsie494!";

const results = [];
const consoleErrors = [];
const netFailures = [];

function log(step, detail) {
  console.log(`[${step}] ${detail}`);
  results.push({ step, detail });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!text.includes("favicon") && !text.includes("ResizeObserver")) {
        consoleErrors.push(text.slice(0, 300));
      }
    }
  });
  page.on("pageerror", (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));
  page.on("response", (resp) => {
    const status = resp.status();
    if (status === 401 || status === 403 || status === 404 || status === 406 || status >= 500) {
      const url = resp.url();
      if (url.includes("supabase") || url.includes("/api/")) {
        netFailures.push(`${status} ${url.replace(/[?&]apikey=[^&]*/, "").slice(0, 200)}`);
      }
    }
  });

  try {
    // ── 1. Login ──────────────────────────────────────────────────────────
    log("NAV", `${BASE}/login`);
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

    const emailToggle = page.getByRole("button", { name: /sign in with email/i });
    if (await emailToggle.count()) {
      await emailToggle.first().click();
    }
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    const submitBtn = page.getByRole("button", { name: /^sign in$|^log in$|^continue$/i });
    await submitBtn.first().click();

    await page.waitForURL(/\/dashboard/, { timeout: 45000 });
    log("LOGIN", "redirected to /dashboard");
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // ── 2. Sidebar check — hover to expand, then read nav items by href ──
    const aside = page.locator("aside").first();
    await aside.hover().catch(() => {});
    await page.waitForTimeout(500);
    const navHrefs = await aside.locator("button").evaluateAll((els) =>
      els
        .map((el) => {
          const textNode = el.querySelector("span");
          return textNode ? textNode.textContent?.trim() : null;
        })
        .filter(Boolean)
    );
    log("SIDEBAR", `nav items: ${JSON.stringify(navHrefs)}`);

    // ── 3. /intel direct nav → expect 404 ─────────────────────────────────
    await page.goto(`${BASE}/intel`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    const intelBody = await page.locator("body").innerText().catch(() => "");
    log("INTEL", intelBody.includes("404") ? "404 rendered ✓" : `unexpected: ${intelBody.slice(0, 150)}`);

    // ── 4. /projects ──────────────────────────────────────────────────────
    await page.goto(`${BASE}/projects`);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    // Find the "X Projects" metric or any project row
    const projectAnchors = await page.locator('a[href^="/projects/"]').count();
    const projBody = await page.locator("main").innerText().catch(() => "");
    log("PROJECTS", `anchors found: ${projectAnchors}, body snippet: ${projBody.replace(/\s+/g, " ").slice(0, 300)}`);

    // ── 5. /clients ───────────────────────────────────────────────────────
    await page.goto(`${BASE}/clients`);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const clientAnchors = await page.locator('a[href^="/clients/"]').count();
    const clientBody = await page.locator("main").innerText().catch(() => "");
    log("CLIENTS", `anchors: ${clientAnchors}, body snippet: ${clientBody.replace(/\s+/g, " ").slice(0, 300)}`);

    // ── 6-7. /invoices /estimates → expect 404 ──────────────────────────
    for (const r of ["invoices", "estimates"]) {
      await page.goto(`${BASE}/${r}`);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      const body = await page.locator("body").innerText().catch(() => "");
      log(r.toUpperCase(), body.includes("404") ? "404 ✓" : `unexpected: ${body.slice(0, 150)}`);
    }

    // ── 8. /settings — check for Company/Billing/Integrations as tab buttons ──
    await page.goto(`${BASE}/settings`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    // Get all visible tab-like buttons and check their text
    const tabButtons = await page.locator('button').evaluateAll((els) =>
      els
        .map((el) => el.textContent?.trim())
        .filter((t) => t && t.length > 0 && t.length < 40)
    );
    const hasCompanyTab = tabButtons.some((t) => /^Company$/i.test(t));
    const hasBillingTab = tabButtons.some((t) => /^Billing$/i.test(t));
    const hasIntegrationsTab = tabButtons.some((t) => /^Integrations$/i.test(t));
    const hasPreferencesTab = tabButtons.some((t) => /^Preferences$/i.test(t));
    log("SETTINGS_TABS", `Company=${hasCompanyTab} Billing=${hasBillingTab} Integrations=${hasIntegrationsTab} Preferences=${hasPreferencesTab}`);
    log("SETTINGS_ALL_BUTTONS", JSON.stringify(tabButtons.filter((t) => t.length < 25).slice(0, 25)));

    // ── 9. Project detail — direct nav to a known Nick-assigned project ──
    const KNOWN_PROJECT_ID = "c0000000-0000-4000-c000-000000000006"; // Flight Deck Coating
    const KNOWN_PROJECT_BAD = "00000000-0000-0000-0000-000000000000"; // unassigned
    log("PROJDETAIL", `navigating to assigned project ${KNOWN_PROJECT_ID}`);
    await page.goto(`${BASE}/projects/${KNOWN_PROJECT_ID}`);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const bodyText = await page.locator("main").innerText().catch(() => "");
    // The tab bar uses buttons with lowercase labels from i18n — scan for "Financial"
    const tabs = await page.locator('button').evaluateAll((els) =>
      els
        .map((el) => el.textContent?.trim())
        .filter((t) => t && t.length > 0 && t.length < 20)
    );
    const hasFinancialTab = tabs.some((t) => /^Financial$/i.test(t));
    const hasInvoiced = /Invoiced/i.test(bodyText);
    const hasOutstanding = /Outstanding/i.test(bodyText);
    log("PROJDETAIL_GATES", `Financial tab=${hasFinancialTab} (expect false), Invoiced tile=${hasInvoiced} (expect false), Outstanding tile=${hasOutstanding} (expect false)`);
    log("PROJDETAIL_BODY", bodyText.replace(/\s+/g, " ").slice(0, 300));

    // ── 10. Direct nav to an UNASSIGNED random project → expect 404 ──
    await page.goto(`${BASE}/projects/${KNOWN_PROJECT_BAD}`);
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const badBody = await page.locator("body").innerText().catch(() => "");
    log("PROJDETAIL_BAD", badBody.includes("404") || /not found/i.test(badBody) ? "404/not-found rendered ✓" : `unexpected: ${badBody.slice(0, 200)}`);
  } catch (err) {
    log("ERROR", err.message);
  } finally {
    console.log("\n=== CONSOLE ERRORS ===");
    if (consoleErrors.length === 0) console.log("(none)");
    else for (const e of consoleErrors.slice(0, 10)) console.log("  - " + e);

    console.log("\n=== NETWORK FAILURES (supabase + api) ===");
    // Dedupe and show URL path only for readability
    const unique = new Set(netFailures.map((f) => f.replace(/\/rest\/v1\//, "/").replace(/\?.*/, "")));
    if (unique.size === 0) console.log("(none)");
    else for (const u of Array.from(unique).slice(0, 30)) console.log("  - " + u);
    await browser.close();
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
