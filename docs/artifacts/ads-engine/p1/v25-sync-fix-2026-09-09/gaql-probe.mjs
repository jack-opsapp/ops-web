// Read-only probe against the live Google Ads account. searchStream only —
// this script cannot mutate. It answers three questions the local sync run
// raised:
//   1. does v25 accept campaign.start_date_time / campaign.end_date_time?
//   2. does v25 accept the campaign_shared_set resource?
//   3. does the account actually hold any campaign_shared_set attachments,
//      with and without the status != 'REMOVED' filter the sync applies?
import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    })
);
function pem(raw) {
  let k = raw.replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
  if (k.includes("-----BEGIN")) return k;
  const b = k.replace(/\s/g, "");
  return `-----BEGIN PRIVATE KEY-----\n${(b.match(/.{1,64}/g) || [b]).join("\n")}\n-----END PRIVATE KEY-----\n`;
}
const creds = env.FIREBASE_ADMIN_SERVICE_ACCOUNT
  ? JSON.parse(env.FIREBASE_ADMIN_SERVICE_ACCOUNT)
  : { client_email: env.FIREBASE_ADMIN_CLIENT_EMAIL, private_key: pem(env.FIREBASE_ADMIN_PRIVATE_KEY) };
const auth = new GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/adwords"] });
const token = (await (await auth.getClient()).getAccessToken()).token;
const MANAGER = env.GOOGLE_ADS_CUSTOMER_ID;
const CID = "4454506598"; // the serving account under the manager
const H = {
  Authorization: `Bearer ${token}`,
  "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
  "Content-Type": "application/json",
  "login-customer-id": MANAGER,
};

async function ask(label, query) {
  const r = await fetch(`https://googleads.googleapis.com/v25/customers/${CID}/googleAds:searchStream`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  const rows = Array.isArray(parsed) ? parsed.flatMap((c) => c.results ?? []) : [];
  const errors = [];
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (o.errorCode) errors.push(`${Object.values(o.errorCode)[0]}: ${o.message ?? ""}`);
    for (const v of Object.values(o)) walk(v);
  };
  walk(parsed);
  console.log(`\n── ${label}`);
  console.log(`   HTTP ${r.status}  rows=${rows.length}${errors.length ? `  errors=${JSON.stringify(errors)}` : ""}`);
  if (rows.length) console.log("  ", JSON.stringify(rows.slice(0, 6), null, 2).split("\n").join("\n   "));
  return { status: r.status, rows, errors };
}

// 1 — the fixed campaign query, exactly as the entity snapshot sends it.
await ask(
  "campaign (v25 date-time fields, as the entity snapshot sends it)",
  `SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status,
          campaign.start_date_time, campaign.end_date_time
   FROM campaign
   WHERE campaign.status != 'REMOVED'
   LIMIT 3`
);

// 2 — the removed names, to show the failure the fix removes is real.
await ask(
  "campaign (the v25-removed names, expected UNRECOGNIZED_FIELD)",
  `SELECT campaign.resource_name, campaign.start_date, campaign.end_date
   FROM campaign
   LIMIT 1`
);

// 3 — what shared sets exist at all.
await ask(
  "shared_set",
  `SELECT shared_set.resource_name, shared_set.id, shared_set.name, shared_set.type,
          shared_set.status, shared_set.member_count
   FROM shared_set`
);

// 4 — the attachment query the sync now sends.
await ask(
  "campaign_shared_set (as the entity snapshot sends it: status != 'REMOVED')",
  `SELECT campaign_shared_set.resource_name, campaign_shared_set.campaign,
          campaign_shared_set.shared_set, campaign_shared_set.status
   FROM campaign_shared_set
   WHERE campaign_shared_set.status != 'REMOVED'`
);

// 5 — the same with no status filter: distinguishes "the account has none"
//     from "the filter hid them".
await ask(
  "campaign_shared_set (no status filter)",
  `SELECT campaign_shared_set.resource_name, campaign_shared_set.campaign,
          campaign_shared_set.shared_set, campaign_shared_set.status
   FROM campaign_shared_set`
);
