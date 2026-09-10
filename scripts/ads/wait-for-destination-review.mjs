#!/usr/bin/env node
/**
 * Wait for Google to re-check the landing pages.
 *
 * Ads reviewed before their page existed carry a cached DESTINATION_NOT_WORKING
 * verdict, and that verdict also blocks creating new ads to the same pages
 * (validateOnly answers POLICY_FINDING, type PROHIBITED — not exemptible). The
 * pages are fixed; only Google's re-crawl clears it. This polls the engine
 * campaigns' ads with one cheap query and exits the moment none carries the
 * verdict, so the blueprint apply can run once, cleanly.
 *
 *   node scripts/ads/wait-for-destination-review.mjs [--every 900] [--max 96]
 *
 * Read-only. Exit 0 = cleared; exit 2 = still blocked after --max checks.
 */
import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const at = args.indexOf(`--${name}`); return at >= 0 ? Number(args[at + 1]) : fallback; };
const EVERY = flag("every", 900);
const MAX = flag("max", 96);
const ENGINE = ["BRAND · NA", "PRICING · US", "SWITCH · US", "TRADE · US", "CORE · CA"];

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => { const i = l.indexOf("="); let v = l.slice(i + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return [l.slice(0, i).trim(), v]; }));
const pem = (r) => { const k = r.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n"); if (k.includes("-----BEGIN")) return k; const b = k.replace(/\s/g, ""); return `-----BEGIN PRIVATE KEY-----\n${(b.match(/.{1,64}/g) ?? [b]).join("\n")}\n-----END PRIVATE KEY-----\n`; };
const auth = new GoogleAuth({ credentials: { client_email: env.FIREBASE_ADMIN_CLIENT_EMAIL, private_key: pem(env.FIREBASE_ADMIN_PRIVATE_KEY) }, scopes: ["https://www.googleapis.com/auth/adwords"] });

async function check() {
  const token = (await (await auth.getClient()).getAccessToken()).token;
  const query = `SELECT campaign.name, ad_group.name, ad_group_ad.ad.id, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.policy_topic_entries FROM ad_group_ad WHERE campaign.name IN (${ENGINE.map((n) => `'${n}'`).join(",")}) AND ad_group_ad.status != 'REMOVED'`;
  const r = await fetch("https://googleads.googleapis.com/v25/customers/4454506598/googleAds:searchStream", { method: "POST", headers: { Authorization: `Bearer ${token}`, "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN, "Content-Type": "application/json", "login-customer-id": "5448339076" }, body: JSON.stringify({ query }) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
  const rows = JSON.parse(await r.text()).flatMap((b) => b.results ?? []);
  const blocked = rows.filter((x) => (x.adGroupAd.policySummary.policyTopicEntries ?? []).some((t) => t.topic === "DESTINATION_NOT_WORKING"));
  const approval = rows.reduce((a, x) => ((a[x.adGroupAd.policySummary.approvalStatus] = (a[x.adGroupAd.policySummary.approvalStatus] ?? 0) + 1), a), {});
  return { blocked: blocked.length, total: rows.length, approval };
}

for (let i = 1; i <= MAX; i += 1) {
  let result;
  try { result = await check(); } catch (error) { console.log(`${new Date().toISOString()} check ${i} failed: ${error.message}`); await new Promise((r) => setTimeout(r, EVERY * 1000)); continue; }
  console.log(`${new Date().toISOString()} check ${i}: ${result.blocked}/${result.total} ads still flagged DESTINATION_NOT_WORKING · ${JSON.stringify(result.approval)}`);
  if (result.blocked === 0) { console.log("CLEARED — Google has re-checked every landing page."); process.exit(0); }
  if (i < MAX) await new Promise((r) => setTimeout(r, EVERY * 1000));
}
console.log(`STILL BLOCKED after ${MAX} checks.`);
process.exit(2);
