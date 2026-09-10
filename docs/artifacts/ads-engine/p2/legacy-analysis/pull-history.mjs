// Pull the legacy account's full history straight from Google — the warehouse
// never backfilled keyword/ad/ad-group grain. Read-only searchStream.
// Run from the ops-web-ads-engine-p2 root: node docs/artifacts/ads-engine/p2/legacy-analysis/pull-history.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";
const OUT = "docs/artifacts/ads-engine/p2/legacy-analysis";
const CID = "4454506598"; // serving account, never the manager
const RANGE = "segments.date BETWEEN '2025-01-01' AND '2026-09-09'";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l&&!l.startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");let v=l.slice(i+1).trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);return [l.slice(0,i).trim(),v];}));
const pem=(r)=>{let k=r.replace(/^["']|["']$/g,"").replace(/\\n/g,"\n");if(k.includes("-----BEGIN"))return k;const b=k.replace(/\s/g,"");return `-----BEGIN PRIVATE KEY-----\n${(b.match(/.{1,64}/g)||[b]).join("\n")}\n-----END PRIVATE KEY-----\n`;};
const auth = new GoogleAuth({ credentials: { client_email: env.FIREBASE_ADMIN_CLIENT_EMAIL, private_key: pem(env.FIREBASE_ADMIN_PRIVATE_KEY) }, scopes: ["https://www.googleapis.com/auth/adwords"] });
const token = (await (await auth.getClient()).getAccessToken()).token;
async function gaql(query) {
  const r = await fetch(`https://googleads.googleapis.com/v25/customers/${CID}/googleAds:searchStream`, { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN, "Content-Type": "application/json", "login-customer-id": "5448339076" },
    body: JSON.stringify({ query }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 400)}`);
  return JSON.parse(t).flatMap((b) => b.results ?? []);
}
const Q = {
  campaigns: `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.advertising_channel_sub_type, campaign.bidding_strategy_type, campaign.start_date_time, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.all_conversions FROM campaign WHERE ${RANGE}`,
  conversionsByAction: `SELECT campaign.name, segments.conversion_action_name, segments.conversion_action_category, metrics.conversions, metrics.all_conversions FROM campaign WHERE ${RANGE} AND metrics.all_conversions > 0`,
  keywords: `SELECT campaign.name, ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM keyword_view WHERE ${RANGE} AND metrics.impressions > 0`,
  ads: `SELECT campaign.name, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.final_urls, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group_ad WHERE ${RANGE} AND metrics.impressions > 0`,
  searchTerms: `SELECT campaign.name, search_term_view.search_term, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM search_term_view WHERE ${RANGE} AND metrics.clicks > 0`,
  monthly: `SELECT campaign.name, segments.month, metrics.cost_micros, metrics.clicks, metrics.conversions FROM campaign WHERE ${RANGE} AND metrics.cost_micros > 0`,
  geo: `SELECT campaign.name, geographic_view.country_criterion_id, geographic_view.location_type, metrics.cost_micros, metrics.clicks, metrics.conversions FROM geographic_view WHERE ${RANGE} AND metrics.clicks > 0`,
};
const summary = {};
for (const [name, q] of Object.entries(Q)) {
  try { const rows = await gaql(q); writeFileSync(`${OUT}/${name}.json`, JSON.stringify(rows, null, 1)); summary[name] = rows.length; }
  catch (e) { summary[name] = `ERROR ${e.message.slice(0, 300)}`; }
}
console.log(JSON.stringify(summary, null, 1));
