/* ── scripts/backfill-project-geocoding.ts ── */
/*
 * Backfill `latitude` / `longitude` on projects, clients, and opportunities
 * by forward-geocoding their `address` column via Mapbox Geocoding API v6.
 *
 * Idempotent — re-running skips rows that already have lat/lng populated.
 *
 * Dry-run by default. Pass --apply to write rows. Pass --table=<name> to
 * limit to one table (projects | clients | opportunities). Verbose hits and
 * misses always log to stdout; misses also dump the address for follow-up.
 *
 *   npx tsx scripts/backfill-project-geocoding.ts                  # report only
 *   npx tsx scripts/backfill-project-geocoding.ts --apply          # geocode all 3 tables
 *   npx tsx scripts/backfill-project-geocoding.ts --apply --table=projects
 *
 * Cost: ~92 forward-geocode calls expected (9 projects + 51 clients + 32
 * opportunities at audit time). Mapbox free tier covers 100k/mo, so $0.
 *
 * Required env (no defaults — fail fast if missing):
 *   NEXT_PUBLIC_SUPABASE_URL    (any environment that points at prod)
 *   SUPABASE_SERVICE_ROLE_KEY   (bypasses RLS to update arbitrary rows)
 *   MAPBOX_SERVER_TOKEN         (sk.* secret token; pk.* public token also
 *                               accepted but the public token is rate-shared
 *                               with the browser, so prefer sk.*)
 *
 * Why a separate server token:
 *   The plan document at docs/plans/2026-05-06-project-workspace-modal-implementation.md
 *   recommends `sk.*` so the URL allowlist on the public token (when it gets
 *   one) doesn't block this script. As of 2026-05-07 the public token has no
 *   allowlist, but sk.* is still the safer choice and decouples this script
 *   from any future allowlist tightening.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAPBOX_TOKEN = process.env.MAPBOX_SERVER_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and/or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!MAPBOX_TOKEN) {
  console.error("Missing MAPBOX_SERVER_TOKEN — provision an sk.* token at account.mapbox.com/access-tokens/");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const tableArg = process.argv.find((a) => a.startsWith("--table="));
const ONLY_TABLE = tableArg?.split("=")[1] as Table | undefined;

type Table = "projects" | "clients" | "opportunities";
const TABLES: Table[] = ["projects", "clients", "opportunities"];

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const url =
    `https://api.mapbox.com/search/geocode/v6/forward` +
    `?q=${encodeURIComponent(address)}` +
    `&access_token=${MAPBOX_TOKEN}` +
    `&limit=1`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  geocode HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    return null;
  }
  const data = (await res.json()) as {
    features?: Array<{ geometry?: { coordinates?: [number, number] } }>;
  };
  const feat = data.features?.[0];
  const coords = feat?.geometry?.coordinates;
  if (!coords || coords.length !== 2) return null;
  const [lng, lat] = coords;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng };
}

async function backfillTable(table: Table) {
  console.log(`\n[${table}] querying rows needing geocoding…`);
  const { data, error } = await supabase
    .from(table)
    .select("id, address")
    .not("address", "is", null)
    .neq("address", "")
    .is("latitude", null)
    .is("deleted_at", null);
  if (error) {
    console.error(`[${table}] select failed:`, error);
    return;
  }
  if (!data?.length) {
    console.log(`[${table}] nothing to geocode.`);
    return;
  }
  console.log(`[${table}] ${data.length} rows queued${APPLY ? "" : " (dry-run — use --apply to write)"}.`);

  let ok = 0;
  let fail = 0;
  for (const row of data) {
    const address = (row as { address: string | null }).address;
    if (!address) continue;
    const result = await geocode(address);
    if (!result) {
      console.log(`[${table}] miss: ${row.id} "${address}"`);
      fail++;
      continue;
    }
    if (APPLY) {
      const { error: upErr } = await supabase
        .from(table)
        .update({ latitude: result.lat, longitude: result.lng })
        .eq("id", row.id);
      if (upErr) {
        console.error(`[${table}] update failed: ${row.id}`, upErr);
        fail++;
        continue;
      }
    }
    ok++;
    if (ok % 10 === 0) {
      console.log(`[${table}]   ${ok} ${APPLY ? "written" : "geocoded"}…`);
    }
    // Rate limit: Mapbox v6 forward endpoint is 600/min; 120ms keeps us at ~500/min.
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`[${table}] done: ${ok} ${APPLY ? "written" : "geocoded"}, ${fail} miss/fail.`);
}

(async () => {
  const targets = ONLY_TABLE ? [ONLY_TABLE] : TABLES;
  if (ONLY_TABLE && !TABLES.includes(ONLY_TABLE)) {
    console.error(`unknown --table=${ONLY_TABLE}; allowed: ${TABLES.join(", ")}`);
    process.exit(1);
  }
  console.log(`backfill mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);
  console.log(`tables:        ${targets.join(", ")}`);
  for (const t of targets) {
    await backfillTable(t);
  }
  console.log("\nbackfill complete.");
  process.exit(0);
})().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
