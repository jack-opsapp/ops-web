// One-off restore (2026-09-11): the engine's disapproved-ad guardrail paused the
// eleven non-brand control ads on 2026-09-10 14:59Z while Google's stale
// DESTINATION_NOT_WORKING verdict stood. Google cleared it 2026-09-11 08:29Z and
// the ads are APPROVED. Jackson approved each group running its control next to
// the new challenger, so re-enable exactly those eleven: validateOnly first,
// then real, then read back. Campaigns stay PAUSED; nothing can spend.
import { readFileSync, writeFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => { const i = l.indexOf("="); let v = l.slice(i + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); return [l.slice(0, i).trim(), v]; }));
const pem = (r) => { const k = r.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n"); if (k.includes("-----BEGIN")) return k; const b = k.replace(/\s/g, ""); return `-----BEGIN PRIVATE KEY-----\n${(b.match(/.{1,64}/g) ?? [b]).join("\n")}\n-----END PRIVATE KEY-----\n`; };
const auth = new GoogleAuth({ credentials: { client_email: env.FIREBASE_ADMIN_CLIENT_EMAIL, private_key: pem(env.FIREBASE_ADMIN_PRIVATE_KEY) }, scopes: ["https://www.googleapis.com/auth/adwords"] });
const token = (await (await auth.getClient()).getAccessToken()).token;
const H = { Authorization: `Bearer ${token}`, "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN, "Content-Type": "application/json", "login-customer-id": "5448339076" };
const BASE = "https://googleads.googleapis.com/v25/customers/4454506598";
const ENGINE = ["PRICING · US", "SWITCH · US", "TRADE · US", "CORE · CA"];
const retired = new Set(JSON.parse(readFileSync("config/ads/blueprint.json", "utf8")).retire.adIds);
const read = async () => { const r = await fetch(`${BASE}/googleAds:searchStream`, { method: "POST", headers: H, body: JSON.stringify({ query: `SELECT campaign.name, ad_group.name, ad_group_ad.resource_name, ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.policy_summary.approval_status FROM ad_group_ad WHERE campaign.name IN (${ENGINE.map((n) => `'${n}'`).join(",")}) AND ad_group_ad.status != 'REMOVED'` }) }); const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`); return JSON.parse(t).flatMap((b) => b.results ?? []); };
const before = await read();
const targets = before.filter((x) => x.adGroupAd.status === "PAUSED" && !retired.has(String(x.adGroupAd.ad.id)) && x.adGroupAd.policySummary.approvalStatus === "APPROVED");
console.log(`targets: ${targets.length} (expect 11)`);
for (const x of targets) console.log("  ", x.campaign.name.padEnd(13), x.adGroup.name.padEnd(26), x.adGroupAd.ad.id);
if (targets.length !== 11 || new Set(targets.map((x) => x.adGroup.name)).size !== 11) { console.log("ABORT: not exactly one paused, approved, non-retired ad per non-brand group"); process.exit(1); }
const ops = targets.map((x) => ({ adGroupAdOperation: { update: { resourceName: x.adGroupAd.resourceName, status: "ENABLED" }, updateMask: "status" } }));
const mutate = async (validateOnly) => { const r = await fetch(`${BASE}/googleAds:mutate`, { method: "POST", headers: H, body: JSON.stringify({ mutateOperations: ops, partialFailure: false, validateOnly }) }); const t = await r.text(); return { status: r.status, requestId: r.headers.get("request-id"), body: t.slice(0, 600) }; };
const v = await mutate(true); console.log("validateOnly:", v.status, v.requestId); if (v.status !== 200) { console.log(v.body); process.exit(1); }
const real = await mutate(false); console.log("real:", real.status, real.requestId); if (real.status !== 200) { console.log(real.body); process.exit(1); }
const after = await read();
const tally = after.reduce((a, x) => { const k = `${retired.has(String(x.adGroupAd.ad.id)) ? "retired challenger" : x.adGroupAd.policySummary.approvalStatus === "UNKNOWN" ? "new challenger" : "control"} · ${x.adGroupAd.status} · ${x.adGroupAd.policySummary.approvalStatus}`; a[k] = (a[k] ?? 0) + 1; return a; }, {});
console.log("after:"); for (const [k, n] of Object.entries(tally).sort()) console.log("  ", String(n).padStart(3), k);
writeFileSync("docs/artifacts/ads-engine/p2/restore-lead-ads-2026-09-11.json", JSON.stringify({ targets: targets.map((x) => x.adGroupAd.resourceName), validate: v, real, after: tally }, null, 1));
