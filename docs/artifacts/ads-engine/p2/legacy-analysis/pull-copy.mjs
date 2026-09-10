// The legacy ads' own words, and how Google scored each line. Read-only.
// Run from the ops-web-ads-engine-p2 root.
import { readFileSync, writeFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";
const OUT = "docs/artifacts/ads-engine/p2/legacy-analysis";
const CID = "4454506598";
const RANGE = "segments.date BETWEEN '2025-01-01' AND '2026-09-09'";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");let v=l.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);return [l.slice(0,i).trim(),v];}));
const pem=(r)=>{let k=r.replace(/^["']|["']$/g,"").replace(/\\n/g,"\n");if(k.includes("-----BEGIN"))return k;const b=k.replace(/\s/g,"");return `-----BEGIN PRIVATE KEY-----\n${(b.match(/.{1,64}/g)||[b]).join("\n")}\n-----END PRIVATE KEY-----\n`;};
const auth = new GoogleAuth({ credentials: { client_email: env.FIREBASE_ADMIN_CLIENT_EMAIL, private_key: pem(env.FIREBASE_ADMIN_PRIVATE_KEY) }, scopes: ["https://www.googleapis.com/auth/adwords"] });
const token = (await (await auth.getClient()).getAccessToken()).token;
async function gaql(query) {
  const r = await fetch(`https://googleads.googleapis.com/v25/customers/${CID}/googleAds:searchStream`, { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN, "Content-Type": "application/json", "login-customer-id": "5448339076" },
    body: JSON.stringify({ query }) });
  const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 500)}`);
  return JSON.parse(t).flatMap((b) => b.results ?? []);
}
const Q = {
  adText: `SELECT campaign.name, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.responsive_display_ad.headlines, ad_group_ad.ad.responsive_display_ad.long_headline, ad_group_ad.ad.responsive_display_ad.descriptions, ad_group_ad.ad.responsive_display_ad.business_name, ad_group_ad.ad.app_ad.headlines, ad_group_ad.ad.app_ad.descriptions, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, metrics.impressions, metrics.clicks, metrics.cost_micros FROM ad_group_ad WHERE ${RANGE} AND metrics.impressions > 0`,
  assetPerf: `SELECT campaign.name, campaign.advertising_channel_type, ad_group_ad.ad.id, ad_group_ad_asset_view.field_type, ad_group_ad_asset_view.performance_label, ad_group_ad_asset_view.pinned_field, asset.text_asset.text, metrics.impressions, metrics.clicks FROM ad_group_ad_asset_view WHERE ${RANGE} AND metrics.impressions > 0`,
};
const summary = {};
for (const [name, q] of Object.entries(Q)) {
  try { const rows = await gaql(q); writeFileSync(`${OUT}/${name}.json`, JSON.stringify(rows, null, 1)); summary[name] = rows.length; }
  catch (e) { summary[name] = `ERROR ${e.message.slice(0, 400)}`; }
}
console.log(JSON.stringify(summary, null, 1));
