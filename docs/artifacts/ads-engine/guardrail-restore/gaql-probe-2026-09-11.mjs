#!/usr/bin/env node
/**
 * Read-only proof of the exact GAQL the guardrail's live reads send
 * (GOOGLE ADS ENGINE - P2-1-1, 2026-09-11). Nothing is written to Google.
 *
 *   node docs/artifacts/ads-engine/guardrail-restore/gaql-probe-2026-09-11.mjs
 *
 * Proves, against the real serving account:
 *   1. ad_group_ad.policy_summary.policy_topic_entries is selectable and what
 *      a topic entry looks like on these ads;
 *   2. the change_event query shape (date bounds, resource-type filter,
 *      LIMIT) is accepted, and what the guardrail's own 2026-09-10 14:59Z
 *      pauses and the 2026-09-11 manual restore look like in it;
 *   3. whether change_event accepts a change_resource_name IN (...) filter;
 *   4. the lookback limit Google enforces on change_event;
 *   5. the account time zone change_date_time is written in.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

const SERVING = "4454506598";
const MANAGER = "5448339076";
const OUT = "docs/artifacts/ads-engine/guardrail-restore/gaql-probe-2026-09-11.json";

// The 22 ads the guardrail paused at 2026-09-10 14:59Z (ads_engine_alerts).
const ADS = [
  "200351113415~824125294528", "200351113415~824125294531",
  "200351113575~824125294534", "200351113575~824125294537",
  "200351113615~824125294540", "200351113615~824125294543",
  "200351113655~824125294546", "200351113655~824125294549",
  "200351113815~824125294552", "200351113815~824125294555",
  "200351113855~824125294558", "200351113855~824125294681",
  "200351113895~824125294684", "200351113895~824125294687",
  "200351114055~824125294690", "200351114055~824125294693",
  "200351114095~824125294696", "200351114095~824125294699",
  "200351114135~824125294702", "200351114135~824125294705",
  "200351114295~824125294708", "200351114295~824125294711",
].map((key) => `customers/${SERVING}/adGroupAds/${key}`);

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
  const response = await fetch(`https://googleads.googleapis.com/v25/customers/${SERVING}/googleAds:searchStream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
      "Content-Type": "application/json",
      "login-customer-id": MANAGER,
    },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  const requestId = response.headers.get("request-id");
  if (!response.ok) return { ok: false, status: response.status, requestId, error: text.slice(0, 1500) };
  const rows = JSON.parse(text).flatMap((chunk) => chunk.results ?? []);
  return { ok: true, status: response.status, requestId, rows };
}

const quoted = (values) => values.map((v) => `'${v}'`).join(", ");

const adPolicy = await gaql(
  `SELECT ad_group_ad.resource_name, ad_group_ad.status, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status, ad_group_ad.policy_summary.policy_topic_entries FROM ad_group_ad WHERE ad_group_ad.resource_name IN (${quoted(ADS)})`
);

const CHANGE_FIELDS =
  "change_event.resource_name, change_event.change_date_time, change_event.change_resource_name, change_event.change_resource_type, change_event.client_type, change_event.user_email, change_event.resource_change_operation, change_event.changed_fields, change_event.old_resource, change_event.new_resource";

const changes = await gaql(
  `SELECT ${CHANGE_FIELDS} FROM change_event WHERE change_event.change_date_time >= '2026-09-09' AND change_event.change_date_time <= '2026-09-12' AND change_event.change_resource_type = 'AD_GROUP_AD' ORDER BY change_event.change_date_time ASC LIMIT 10000`
);

const changesByName = await gaql(
  `SELECT ${CHANGE_FIELDS} FROM change_event WHERE change_event.change_date_time >= '2026-09-09' AND change_event.change_date_time <= '2026-09-12' AND change_event.change_resource_type = 'AD_GROUP_AD' AND change_event.change_resource_name IN (${quoted(ADS.slice(0, 2))}) ORDER BY change_event.change_date_time ASC LIMIT 10000`
);

const tooOld = await gaql(
  `SELECT change_event.resource_name FROM change_event WHERE change_event.change_date_time >= '2026-08-01' AND change_event.change_date_time <= '2026-09-12' AND change_event.change_resource_type = 'AD_GROUP_AD' LIMIT 10`
);

const noUpperBound = await gaql(
  `SELECT change_event.resource_name FROM change_event WHERE change_event.change_date_time >= '2026-09-09' AND change_event.change_resource_type = 'AD_GROUP_AD' LIMIT 10`
);

const timeZone = await gaql("SELECT customer.time_zone FROM customer");

const summarizeChanges = (result) =>
  result.ok
    ? result.rows.map((row) => {
        const e = row.changeEvent;
        return {
          at: e.changeDateTime,
          micros: e.resourceName.split("/").pop().split("~")[0],
          ad: e.changeResourceName,
          client: e.clientType,
          user: e.userEmail,
          op: e.resourceChangeOperation,
          fields: e.changedFields,
          from: e.oldResource?.adGroupAd?.status ?? null,
          to: e.newResource?.adGroupAd?.status ?? null,
        };
      })
    : result;

const report = {
  probedAt: new Date().toISOString(),
  adPolicy: adPolicy.ok
    ? {
        requestId: adPolicy.requestId,
        rows: adPolicy.rows.map((row) => ({
          ad: row.adGroupAd.resourceName,
          status: row.adGroupAd.status,
          approval: row.adGroupAd.policySummary?.approvalStatus ?? null,
          review: row.adGroupAd.policySummary?.reviewStatus ?? null,
          topics: row.adGroupAd.policySummary?.policyTopicEntries ?? [],
        })),
      }
    : adPolicy,
  changes: { requestId: changes.requestId ?? null, count: changes.ok ? changes.rows.length : null, events: summarizeChanges(changes), rawFirst: changes.ok ? changes.rows[0] ?? null : null },
  changesByName: { ok: changesByName.ok, count: changesByName.ok ? changesByName.rows.length : null, error: changesByName.ok ? null : changesByName.error },
  tooOld: { ok: tooOld.ok, status: tooOld.status, error: tooOld.ok ? null : tooOld.error },
  noUpperBound: { ok: noUpperBound.ok, status: noUpperBound.status, error: noUpperBound.ok ? null : noUpperBound.error },
  timeZone: timeZone.ok ? timeZone.rows[0]?.customer?.timeZone ?? null : timeZone,
};

writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`adPolicy ${adPolicy.ok ? `${adPolicy.rows.length} rows` : `FAILED ${adPolicy.status}`}`);
console.log(`changes ${changes.ok ? `${changes.rows.length} events` : `FAILED ${changes.status}`}`);
console.log(`changesByName ${changesByName.ok ? `ok ${changesByName.rows.length}` : `FAILED ${changesByName.status}`}`);
console.log(`tooOld ${tooOld.ok ? "accepted" : `refused ${tooOld.status}`}`);
console.log(`noUpperBound ${noUpperBound.ok ? "accepted" : `refused ${noUpperBound.status}`}`);
console.log(`timeZone ${report.timeZone}`);
console.log(`wrote ${OUT}`);
