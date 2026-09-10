// Every asset the account carries — account-level (which attaches to EVERY
// campaign, the new ones included), campaign-level, and the automation settings
// on the five engine campaigns. Read-only. Run from the ops-web-ads-engine-p2 root.
import { readFileSync, writeFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";
const OUT = "docs/artifacts/ads-engine/p2/legacy-analysis";
const RANGE = "segments.date BETWEEN '2025-01-01' AND '2026-09-10'";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");let v=l.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);return [l.slice(0,i).trim(),v];}));
const pem=(r)=>{let k=r.replace(/^["']|["']$/g,"").replace(/\\n/g,"\n");if(k.includes("-----BEGIN"))return k;const b=k.replace(/\s/g,"");return `-----BEGIN PRIVATE KEY-----\n${(b.match(/.{1,64}/g)||[b]).join("\n")}\n-----END PRIVATE KEY-----\n`;};
const auth = new GoogleAuth({ credentials: { client_email: env.FIREBASE_ADMIN_CLIENT_EMAIL, private_key: pem(env.FIREBASE_ADMIN_PRIVATE_KEY) }, scopes: ["https://www.googleapis.com/auth/adwords"] });
const token = (await (await auth.getClient()).getAccessToken()).token;
async function gaql(query) {
  const r = await fetch("https://googleads.googleapis.com/v25/customers/4454506598/googleAds:searchStream", { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN, "Content-Type": "application/json", "login-customer-id": "5448339076" }, body: JSON.stringify({ query }) });
  const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 500)}`);
  return JSON.parse(t).flatMap((b) => b.results ?? []);
}
const ASSET = "asset.id, asset.type, asset.name, asset.final_urls, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2, asset.callout_asset.callout_text, asset.structured_snippet_asset.header, asset.structured_snippet_asset.values, asset.text_asset.text, asset.image_asset.full_size.url";
const Q = {
  accountAssets: `SELECT customer_asset.field_type, customer_asset.status, customer_asset.source, customer_asset.primary_status, ${ASSET} FROM customer_asset`,
  accountAssetPerf: `SELECT customer_asset.field_type, ${ASSET}, metrics.impressions, metrics.clicks FROM customer_asset WHERE ${RANGE}`,
  campaignAssets: `SELECT campaign.name, campaign.status, campaign_asset.field_type, campaign_asset.status, campaign_asset.source, ${ASSET} FROM campaign_asset`,
  campaignAssetPerf: `SELECT campaign.name, campaign_asset.field_type, ${ASSET}, metrics.impressions, metrics.clicks FROM campaign_asset WHERE ${RANGE}`,
  engineAutomation: `SELECT campaign.name, campaign.asset_automation_settings FROM campaign WHERE campaign.name IN ('BRAND · NA','PRICING · US','SWITCH · US','TRADE · US','CORE · CA')`,
};
const summary = {};
for (const [name, q] of Object.entries(Q)) {
  try { const rows = await gaql(q); writeFileSync(`${OUT}/${name}.json`, JSON.stringify(rows, null, 1)); summary[name] = rows.length; }
  catch (e) { summary[name] = `ERROR ${e.message.slice(0, 400)}`; }
}
console.log(JSON.stringify(summary, null, 1));
