// How every image, video and logo performed in the legacy ads — display and app
// ads carry them per ad; Performance Max carries them per asset group. Read-only.
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
const MEDIA = "asset.id, asset.type, asset.name, asset.image_asset.full_size.url, asset.image_asset.full_size.width_pixels, asset.image_asset.full_size.height_pixels, asset.youtube_video_asset.youtube_video_id, asset.youtube_video_asset.youtube_video_title";
const Q = {
  adMedia: `SELECT campaign.name, campaign.advertising_channel_type, ad_group.name, ad_group_ad.ad.id, ad_group_ad_asset_view.field_type, ad_group_ad_asset_view.performance_label, ${MEDIA}, metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros FROM ad_group_ad_asset_view WHERE ${RANGE} AND asset.type IN ('IMAGE','YOUTUBE_VIDEO','MEDIA_BUNDLE') AND metrics.impressions > 0`,
  pmaxMedia: `SELECT campaign.name, asset_group.name, asset_group_asset.field_type, asset_group_asset.performance_label, asset_group_asset.status, ${MEDIA} FROM asset_group_asset WHERE asset.type IN ('IMAGE','YOUTUBE_VIDEO')`,
  pmaxMediaMetrics: `SELECT campaign.name, asset_group.name, asset_group_asset.field_type, ${MEDIA}, metrics.impressions, metrics.clicks, metrics.conversions FROM asset_group_asset WHERE ${RANGE} AND asset.type IN ('IMAGE','YOUTUBE_VIDEO')`,
  pmaxGroups: `SELECT campaign.name, asset_group.name, asset_group.ad_strength, metrics.impressions, metrics.clicks, metrics.conversions, metrics.cost_micros FROM asset_group WHERE ${RANGE}`,
};
const summary = {};
for (const [name, q] of Object.entries(Q)) {
  try { const rows = await gaql(q); writeFileSync(`${OUT}/${name}.json`, JSON.stringify(rows, null, 1)); summary[name] = rows.length; }
  catch (e) { summary[name] = `ERROR ${e.message.slice(0, 300)}`; }
}
console.log(JSON.stringify(summary, null, 1));
