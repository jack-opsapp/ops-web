#!/usr/bin/env node
/**
 * Dump what the Google Ads account actually contains, straight from Google.
 *
 * The warehouse snapshot is a copy; this is the source. Use it to prove an
 * apply landed, to check whether Google has finished reviewing the ads, or to
 * settle any disagreement between the blueprint and reality.
 *
 *   node scripts/ads/account-state.mjs > docs/artifacts/ads-engine/p2/account-state.json
 *   node scripts/ads/account-state.mjs --summary
 *
 * Read-only. It runs `searchStream` and writes nothing anywhere.
 */
import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

/**
 * The serving account, not the manager. `GOOGLE_ADS_CUSTOMER_ID` holds the
 * manager id (5448339076); querying that returns an empty account and looks
 * exactly like a wiped one.
 */
const SERVING_CUSTOMER_ID = "4454506598";
const ENGINE = new Set(["BRAND · NA", "PRICING · US", "SWITCH · US", "TRADE · US", "CORE · CA"]);

function readEnv(path = ".env.local") {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        let value = line.slice(at + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
          value = value.slice(1, -1);
        return [line.slice(0, at).trim(), value];
      })
  );
}

function pem(raw) {
  const key = raw.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
  if (key.includes("-----BEGIN")) return key;
  const body = key.replace(/\s/g, "");
  return `-----BEGIN PRIVATE KEY-----\n${(body.match(/.{1,64}/g) ?? [body]).join("\n")}\n-----END PRIVATE KEY-----\n`;
}

const env = readEnv();
const credentials = env.FIREBASE_ADMIN_SERVICE_ACCOUNT
  ? JSON.parse(env.FIREBASE_ADMIN_SERVICE_ACCOUNT)
  : { client_email: env.FIREBASE_ADMIN_CLIENT_EMAIL, private_key: pem(env.FIREBASE_ADMIN_PRIVATE_KEY) };
const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/adwords"] });
const token = (await (await auth.getClient()).getAccessToken()).token;

async function gaql(query) {
  const response = await fetch(
    `https://googleads.googleapis.com/v25/customers/${SERVING_CUSTOMER_ID}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
        "Content-Type": "application/json",
        "login-customer-id": env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "5448339076",
      },
      body: JSON.stringify({ query }),
    }
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 800)}`);
  return JSON.parse(text).flatMap((batch) => batch.results ?? []);
}

const state = {
  readAt: new Date().toISOString(),
  customerId: SERVING_CUSTOMER_ID,
  campaigns: (
    await gaql(
      `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
              campaign.bidding_strategy_type, campaign.target_spend.cpc_bid_ceiling_micros,
              campaign.network_settings.target_google_search, campaign.network_settings.target_search_network,
              campaign.network_settings.target_content_network,
              campaign.geo_target_type_setting.positive_geo_target_type, campaign_budget.amount_micros
       FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.name`
    )
  ).map((r) => ({
    name: r.campaign.name,
    status: r.campaign.status,
    type: r.campaign.advertisingChannelType,
    bidding: r.campaign.biddingStrategyType,
    ceiling: r.campaign.targetSpend?.cpcBidCeilingMicros ?? null,
    search: r.campaign.networkSettings?.targetGoogleSearch,
    partners: r.campaign.networkSettings?.targetSearchNetwork,
    display: r.campaign.networkSettings?.targetContentNetwork,
    geoType: r.campaign.geoTargetTypeSetting?.positiveGeoTargetType,
    budget: r.campaignBudget?.amountMicros,
  })),
  labels: (await gaql(`SELECT campaign.name, label.name FROM campaign_label ORDER BY label.name, campaign.name`)).map(
    (r) => `${r.label.name} :: ${r.campaign.name}`
  ),
  adGroups: (
    await gaql(
      `SELECT campaign.name, ad_group.name, ad_group.status, ad_group.cpc_bid_micros
       FROM ad_group WHERE ad_group.status != 'REMOVED' ORDER BY campaign.name, ad_group.name`
    )
  ).map((r) => `${r.campaign.name} › ${r.adGroup.name} [${r.adGroup.status}]${r.adGroup.cpcBidMicros ? ` bid ${r.adGroup.cpcBidMicros}` : ""}`),
  keywords: (
    await gaql(
      `SELECT campaign.name, ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
       FROM keyword_view WHERE ad_group_criterion.status != 'REMOVED' ORDER BY campaign.name, ad_group.name`
    )
  ).map((r) => `${r.campaign.name} › ${r.adGroup.name} :: ${r.adGroupCriterion.keyword.text} [${r.adGroupCriterion.keyword.matchType}]`),
  ads: (
    await gaql(
      `SELECT campaign.name, ad_group.name, ad_group_ad.ad.id, ad_group_ad.status,
              ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status,
              ad_group_ad.ad.final_urls
       FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' ORDER BY campaign.name, ad_group.name`
    )
  ).map((r) => ({
    campaign: r.campaign.name,
    adGroup: r.adGroup.name,
    id: r.adGroupAd.ad.id,
    status: r.adGroupAd.status,
    approval: r.adGroupAd.policySummary?.approvalStatus ?? null,
    review: r.adGroupAd.policySummary?.reviewStatus ?? null,
    url: r.adGroupAd.ad.finalUrls?.[0],
  })),
  adLabels: (await gaql(`SELECT ad_group.name, ad_group_ad.ad.id, label.name FROM ad_group_ad_label`)).map(
    (r) => `${r.adGroup.name} :: ad ${r.adGroupAd.ad.id} :: ${r.label.name}`
  ),
  sharedSets: (
    await gaql(
      `SELECT shared_set.name, shared_set.type, shared_set.member_count FROM shared_set WHERE shared_set.status != 'REMOVED'`
    )
  ).map((r) => `${r.sharedSet.name} [${r.sharedSet.type}] members=${r.sharedSet.memberCount}`),
  attachments: (
    await gaql(
      `SELECT campaign.name, shared_set.name FROM campaign_shared_set WHERE campaign_shared_set.status != 'REMOVED' ORDER BY campaign.name`
    )
  ).map((r) => `${r.campaign.name} ← ${r.sharedSet.name}`),
  campaignNegatives: (
    await gaql(
      `SELECT campaign.name, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
       FROM campaign_criterion WHERE campaign_criterion.negative = true AND campaign_criterion.type = 'KEYWORD'`
    )
  ).map((r) => `${r.campaign.name} :: -${r.campaignCriterion.keyword.text} [${r.campaignCriterion.keyword.matchType}]`),
  geo: (
    await gaql(
      `SELECT campaign.name, campaign_criterion.location.geo_target_constant
       FROM campaign_criterion WHERE campaign_criterion.type = 'LOCATION' ORDER BY campaign.name`
    )
  ).map((r) => `${r.campaign.name} :: ${r.campaignCriterion.location.geoTargetConstant}`),
};

if (process.argv.includes("--summary")) {
  const ads = state.ads.filter((ad) => ENGINE.has(ad.campaign));
  const count = (list, key) =>
    JSON.stringify(list.reduce((acc, item) => ({ ...acc, [item[key] ?? "null"]: (acc[item[key] ?? "null"] ?? 0) + 1 }), {}));
  process.stdout.write(
    [
      `Read at ${state.readAt} from customer ${state.customerId}`,
      "",
      ...state.campaigns
        .filter((c) => ENGINE.has(c.name))
        .map(
          (c) =>
            `  ${c.name.padEnd(14)} ${c.status.padEnd(7)} ${c.type} ${String(c.bidding).padEnd(13)} ceiling ${String(c.ceiling ?? "—").padStart(9)} budget ${c.budget} · search ${c.search} partners ${c.partners} display ${c.display} · ${c.geoType}`
        ),
      "",
      `  ad groups ${state.adGroups.filter((g) => ENGINE.has(g.split(" › ")[0])).length}` +
        ` · keywords ${state.keywords.filter((k) => ENGINE.has(k.split(" › ")[0])).length}` +
        ` · ads ${ads.length}`,
      `  ad approval ${count(ads, "approval")} · review ${count(ads, "review")}`,
      `  negative lists ${state.sharedSets.filter((s) => s.startsWith("NEG")).length} · attachments ${state.attachments.length}`,
      "",
      ...state.sharedSets.map((s) => `  ${s}`),
      "",
    ].join("\n")
  );
} else {
  process.stdout.write(`${JSON.stringify(state, null, 1)}\n`);
}
