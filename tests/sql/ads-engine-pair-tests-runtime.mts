// Runtime contract for the engine repository's pair-test methods
// (GOOGLE ADS ENGINE - P2-1-1-1): the real `createEngineRepository` code,
// through supabase-js and PostgREST, against the real `ads_tests` and
// `ads_daily_ad` tables on a disposable PostgreSQL 17 cluster it creates,
// uses and deletes itself.
//
//   node --conditions=react-server --import tsx tests/sql/ads-engine-pair-tests-runtime.mts
//
// Needs /opt/homebrew/opt/postgresql@17 and /opt/homebrew/bin/postgrest.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { EngineRepository } from "@/lib/ads/engine/repository";

// The app's modules are CommonJS to Node; take the export off whichever face it lands on.
const repositoryModule = (await import("@/lib/ads/engine/repository")) as { createEngineRepository?: (client: unknown) => EngineRepository; default?: { createEngineRepository: (client: unknown) => EngineRepository } };
const createEngineRepository = repositoryModule.createEngineRepository ?? repositoryModule.default!.createEngineRepository;

const bin = "/opt/homebrew/opt/postgresql@17/bin/";
const root = mkdtempSync(join(tmpdir(), "ads-pair-tests-"));
const data = join(root, "data");
const socket = join(root, "socket");
const pgPort = String(56000 + (process.pid % 1000));
const restPort = 3400 + (process.pid % 500);
const db = "ads_pair_tests";
const secret = "ads-pair-tests-local-secret-0123456789abcdef0123456789";

const psql = (query: string) =>
  execFileSync(bin + "psql", ["-h", socket, "-p", pgPort, "-d", db, "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const migration = (suffix: string) => readFileSync(join("supabase/migrations", readdirSync("supabase/migrations").find((file) => file.endsWith(suffix))!), "utf8");

function jwt(role: string): string {
  const enc = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc({ role, iss: "ads-pair-tests", iat: 1700000000, exp: 4102444800 });
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

async function waitFor(check: () => Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

let rest: ReturnType<typeof spawn> | null = null;
let started = false;
try {
  execFileSync(bin + "initdb", ["-D", data, "-U", "postgres", "--auth=trust", "--no-sync"], { stdio: "ignore" });
  execFileSync("mkdir", ["-p", socket]);
  // Postgres refuses to start under a locale it cannot resolve ("postmaster became multithreaded").
  execFileSync(bin + "pg_ctl", ["-D", data, "-l", join(root, "server.log"), "-o", `-p ${pgPort} -k ${socket} -c listen_addresses=''`, "-w", "start"], { stdio: "ignore", env: { ...process.env, LC_ALL: "C" } });
  started = true;
  execFileSync(bin + "createdb", ["-h", socket, "-p", pgPort, "-U", "postgres", db]);
  process.env.PGUSER = "postgres";

  psql(
    "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;" +
      "create role authenticator noinherit login; grant anon, authenticated, service_role to authenticator;" +
      "grant usage on schema public to anon, authenticated, service_role;" +
      // The engine migration's only outside reference.
      "create table public.notifications(id uuid default gen_random_uuid(),user_id text,company_id text,type text,title text,body text,is_read boolean,persistent boolean,action_url text,action_label text,dedupe_key text,resolved_at timestamptz,created_at timestamptz not null default now());"
  );
  psql(migration("_ads_engine.sql"));
  // Only the ad grain, cut from the real warehouse migration: the rest of that
  // file builds a funnel view over tables this contract does not need.
  const adGrain = /create table if not exists public\.ads_daily_ad \([\s\S]*?create index if not exists ads_daily_ad_date_idx[^;]*;/.exec(migration("_ads_warehouse_grain.sql"));
  assert.ok(adGrain, "the warehouse migration still defines ads_daily_ad");
  psql(adGrain[0]);
  psql("grant all on all tables in schema public to service_role;");

  const conf = join(root, "postgrest.conf");
  writeFileSync(
    conf,
    [`db-uri = "postgres://authenticator@/${db}?host=${socket}&port=${pgPort}"`, `db-schemas = "public"`, `db-anon-role = "anon"`, `jwt-secret = "${secret}"`, `server-host = "127.0.0.1"`, `server-port = ${restPort}`, ""].join("\n")
  );
  rest = spawn("/opt/homebrew/bin/postgrest", [conf], { stdio: "ignore" });
  const base = `http://127.0.0.1:${restPort}`;
  await waitFor(async () => (await fetch(`${base}/ads_tests?limit=0`, { headers: { authorization: `Bearer ${jwt("service_role")}` } })).ok, "PostgREST");

  // supabase-js speaks /rest/v1; PostgREST serves at its root.
  const client = createClient("http://supabase.local", jwt("service_role"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(String(input instanceof Request ? input.url : input).replace("http://supabase.local/rest/v1", base), init) },
  });
  const repository = createEngineRepository(client);

  const pair = {
    campaign_id: "11",
    ad_group_id: "21",
    ad_group_name: "Job management",
    control_ad_id: "201",
    challenger_ad_id: "202",
    proposal_id: null,
    label: null,
    started_at: "2026-10-01T07:00:00.000Z",
  };

  // ─── openPairTest ──────────────────────────────────────────────────────────
  assert.deepEqual(await repository.listPairTests(["21"]), [], "no history before the first test");
  const first = await repository.openPairTest(pair);
  assert.match(first ?? "", /^[0-9a-f-]{36}$/, "opens a test and returns its id");
  assert.equal(
    psql(`select state||'|'||coalesce(proposal_id::text,'null')||'|'||coalesce(label,'null')||'|'||started_at at time zone 'UTC'||'|'||min_days||'|'||min_impressions||'|'||max_days from ads_tests where id='${first}'`),
    "running|null|null|2026-10-01 07:00:00|14|2000|56",
    "an adopted test carries no proposal or label, the pair's start, and the spec's verdict rules"
  );
  assert.equal(await repository.openPairTest({ ...pair, challenger_ad_id: "203" }), null, "a group with a running test refuses a second one, as null rather than an error");
  await repository.openPairTest({ ...pair, ad_group_id: "31", ad_group_name: "Jobber alternative", control_ad_id: "204", challenger_ad_id: "205" });

  // ─── listPairTests ─────────────────────────────────────────────────────────
  const history = await repository.listPairTests(["21"]);
  assert.equal(history.length, 1, "only the asked-for groups");
  assert.deepEqual(Object.keys(history[0]).sort(), ["ad_group_id", "ad_group_name", "campaign_id", "challenger_ad_id", "control_ad_id", "id", "max_days", "min_days", "min_impressions", "started_at", "state", "stats", "verdict_at"], "the TestRecord shape");
  assert.equal((await repository.listPairTests(["21", "31"])).length, 2);
  assert.deepEqual(await repository.listPairTests([]), [], "no groups, no query");

  // ─── cancelTest ────────────────────────────────────────────────────────────
  const at = "2026-10-20T15:05:00.000Z";
  assert.equal(await repository.cancelTest(first!, { days: 19, p: 0.3, reason: "The challenger was paused outside the test.", cancelled_at: at }, at), true, "cancels a running test");
  assert.equal(
    psql(`select state||'|'||(verdict_at at time zone 'UTC')||'|'||(stats->>'reason')||'|'||(stats->>'p') from ads_tests where id='${first}'`),
    "cancelled|2026-10-20 15:05:00|The challenger was paused outside the test.|0.3",
    "records the reason and when, keeping the arm stats"
  );
  assert.equal(await repository.cancelTest(first!, { reason: "again" }, at), false, "a test no longer running is left as it is");
  assert.equal(psql(`select stats->>'reason' from ads_tests where id='${first}'`), "The challenger was paused outside the test.");
  assert.equal((await repository.listPairTests(["21"]))[0].state, "cancelled", "history shows the cancellation");
  assert.match((await repository.openPairTest({ ...pair, started_at: "2026-10-21T07:00:00.000Z" })) ?? "", /^[0-9a-f-]{36}$/, "a cancellation frees the group for the pair's next test");

  // ─── firstSharedServingDay ─────────────────────────────────────────────────
  assert.equal(await repository.firstSharedServingDay("201", "202", null), null, "never served");
  psql(
    "insert into ads_daily_ad(date,ad_group_id,ad_id,impressions,clicks) values" +
      "('2026-10-01','21','201',40,2),('2026-10-01','21','202',0,0)," + // the challenger's row with no impressions does not count
      "('2026-10-02','21','201',35,1),('2026-10-02','21','202',5,1)," +
      "('2026-10-03','21','201',30,1),('2026-10-03','21','202',3,0)," +
      "('2026-10-02','31','204',50,3)" // another pair's control
  );
  assert.equal(await repository.firstSharedServingDay("201", "202", null), "2026-10-02", "the first day both recorded impressions");
  assert.equal(await repository.firstSharedServingDay("201", "202", "2026-10-03"), "2026-10-03", "on or after since");
  assert.equal(await repository.firstSharedServingDay("201", "202", "2026-10-04"), null, "nothing shared since");
  assert.equal(await repository.firstSharedServingDay("204", "205", null), null, "a control serving alone is not a shared day");

  // More rows than one PostgREST page: the shared day is on the far side of it.
  const days: string[] = [];
  for (let i = 0; i < 1100; i += 1) days.push(`('${new Date(Date.UTC(2023, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)}','41','206',10,0)`);
  psql(`insert into ads_daily_ad(date,ad_group_id,ad_id,impressions,clicks) values ${days.join(",")},('2026-01-04','41','207',4,0)`);
  assert.equal(await repository.firstSharedServingDay("206", "207", null), "2026-01-04", "reads past the first page");

  console.log("ads-engine pair tests runtime: PASS");
} finally {
  rest?.kill("SIGTERM");
  if (started) execFileSync(bin + "pg_ctl", ["-D", data, "-m", "immediate", "stop"], { stdio: "ignore" });
  rmSync(root, { recursive: true, force: true });
}
