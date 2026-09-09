// The account holds no campaign_shared_set attachments today (see
// gaql-probe.txt), so the live sync could not carry one all the way into the
// warehouse. This closes that last gap: it pushes a row shaped exactly like
// the one queryEntitySnapshot builds through the same HTTP write lane
// supabase-js uses (PostgREST, service-role JWT, upsert on resource_name),
// against the disposable database. A rejected entity_type or a phantom
// column would surface here as PGRST204 / 23514.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("docs/artifacts/ads-engine/p1/v25-sync-fix-2026-09-09/stack/.state/env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const base = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

// Exactly the shape queryEntitySnapshot pushes: resource name in the
// customers/<id>/campaignSharedSets/<campaign>~<set> form the engine's
// snapshot mapper keys on, the campaign as parent, the list as name, and the
// whole searchStream row as payload.
const row = {
  resource_name: "customers/4454506598/campaignSharedSets/22263645060~11814032032",
  entity_type: "campaign_shared_set",
  parent_resource_name: "customers/4454506598/campaigns/22263645060",
  name: "customers/4454506598/sharedSets/11814032032",
  status: "ENABLED",
  payload: {
    campaignSharedSet: {
      resourceName: "customers/4454506598/campaignSharedSets/22263645060~11814032032",
      campaign: "customers/4454506598/campaigns/22263645060",
      sharedSet: "customers/4454506598/sharedSets/11814032032",
      status: "ENABLED",
    },
  },
  labels: [],
  snapshot_at: new Date().toISOString(),
};

const post = await fetch(`${base}/rest/v1/ads_entities?on_conflict=resource_name`, {
  method: "POST",
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=representation",
  },
  body: JSON.stringify([row]),
});
const body = await post.text();
console.log(`upsert campaign_shared_set -> HTTP ${post.status}`);
console.log(body.slice(0, 600));
if (post.status >= 300) process.exit(1);

// And the constraint still refuses a type nobody defined.
const bad = await fetch(`${base}/rest/v1/ads_entities`, {
  method: "POST",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify([{ ...row, resource_name: "customers/1/bogus/1", entity_type: "bogus" }]),
});
console.log(`\nupsert entity_type 'bogus' -> HTTP ${bad.status} (must be a 4xx)`);
console.log((await bad.text()).slice(0, 300));
if (bad.status < 400) process.exit(1);
