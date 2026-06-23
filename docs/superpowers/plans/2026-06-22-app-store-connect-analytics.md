# App Store Connect Analytics — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. All UI tasks additionally invoke the design-skill stack (frontend-design + interface-design + ops-design token reads) and ops-copywriter for copy.

**Goal:** Pull Apple's App Store Connect Analytics (impressions → product-page views → downloads + conversion rate) into Supabase on a daily cron and surface it as a `Growth > App Store` admin screen, built attribution-ready.

**Architecture:** A server-only ASC client (ES256 JWT via `jose`) drives Apple's 6-step async report API → a sync module parses the gzipped TSV by header-name and idempotently upserts into new `asc_*` Supabase tables → cached admin query fns feed five read API routes → an RSC page + `'use client'` content component render KPI tiles, a conversion-rate hero chart, a traffic funnel, a source-channel donut, and a territory table. Everything mirrors the existing Google Ads admin connector.

**Tech Stack:** Next.js App Router (RSC + route handlers), `jose` ^6.1.3 (ES256), Supabase service-role client, `unstable_cache`, TanStack Query, Recharts wrappers, Vitest, Vercel Cron.

**Worktree:** `/Users/jacksonsweet/Projects/OPS/ops-web-app-store-analytics` (branch `feat/app-store-analytics`, off `main`). Dev server: `npm run dev:webpack` (turbopack panics on the node_modules symlink). Preview gate: `.env.local` has `DEV_BYPASS_AUTH` for admin access.

**Reference connector (copy these patterns):** Google Ads — `src/lib/analytics/google-ads-client.ts`, `src/app/api/cron/ads-sync/route.ts`, `src/lib/admin/ads-history-queries.ts` (`updateSyncStatus`), `src/lib/admin/api-auth.ts` (`withAdmin`/`requireAdmin`/`isAdminEmail`), `src/lib/supabase/admin-client.ts` (`getAdminSupabase`), `src/app/admin/app-analytics/` (page + content), `src/lib/admin/date-utils.ts` (`bucketize`), `src/app/admin/_components/` (charts, StatCard, Sparkline, SortableTableHeader, DateRangeControl, AdminPageHeader), `src/lib/firebase/parse-private-key.ts` (`parsePrivateKey`).

---

## File Structure

**Create:**
- `supabase/migrations/<ts>_app_store_connect_analytics_phase1.sql` — all `asc_*` tables, conversion view, RLS (or apply via Supabase MCP; see Task 1).
- `src/lib/analytics/app-store-client.ts` — JWT mint + ASC HTTP client + `isAppStoreConfigured()`.
- `src/lib/analytics/app-store-parse.ts` — header-name TSV parser + `mapAppStoreSourceToChannel()`.
- `src/lib/admin/app-store-sync.ts` — bootstrap + 6-step pull + idempotent upsert + status writes.
- `src/lib/admin/app-store-queries.ts` — `updateAscSyncStatus`/`getAscSyncStatus` + 5 cached read fns + shared types.
- `src/app/api/cron/app-store-sync/route.ts` — daily cron.
- `src/app/api/admin/app-store/{kpis,conversion-series,traffic-series,source-breakdown,territories}/route.ts` — 5 read routes.
- `src/app/admin/app-store/page.tsx` — RSC.
- `src/app/admin/app-store/_components/app-store-content.tsx` — `'use client'`.
- `tests/unit/app-store-parse.test.ts`, `tests/unit/app-store-client.test.ts`, `tests/unit/app-store-sync.test.ts`, `tests/unit/app-store-queries.test.ts` — Vitest.

**Modify:**
- `src/app/admin/_components/sidebar.tsx` — insert `APP STORE` after `GOOGLE ADS` (after line 14).
- `vercel.json` — append the `app-store-sync` cron (after the `ads-sync` entry).
- `src/app/admin/_components/charts/line-chart.tsx` (lines 52, 57) and `bar-chart.tsx` — replace `fontFamily: "Kosugi"` with `"JetBrains Mono"`.

---

## Task 1: Database migration (asc_* tables, conversion view, RLS)

**Files:**
- Create: `supabase/migrations/<ts>_app_store_connect_analytics_phase1.sql`
- Apply: via Supabase MCP `apply_migration` (name `app_store_connect_analytics_phase1`) after read-only recon.

- [ ] **Step 1: Read-only recon.** Confirm none of the `asc_*` names exist and note the Postgres version supports `UNIQUE NULLS NOT DISTINCT` (PG15+; prod is 17.6).

Run (Supabase MCP `execute_sql`):
```sql
select table_name from information_schema.tables
where table_schema='public' and table_name like 'asc[_]%';
select version();
```
Expected: zero `asc_*` rows; PG 17.x.

- [ ] **Step 2: Write the migration SQL** (verbatim from the spec §A4, with the three critic fixes already applied: provisional computed at read time — NOT a stored generated column; `UNIQUE NULLS NOT DISTINCT` on both fact tables; `asc_sync_status` defined; view `security_invoker = true`). Copy the full DDL block from `docs/superpowers/specs/2026-06-22-app-store-connect-analytics-design.md` §A4 into the migration file.

- [ ] **Step 3: Apply the migration** via Supabase MCP `apply_migration` with the SQL from Step 2.
Expected: success, migration recorded.

- [ ] **Step 4: Verify** (Supabase MCP `execute_sql`):
```sql
select table_name from information_schema.tables
where table_schema='public' and table_name like 'asc[_]%' order by 1;
-- expect: asc_downloads, asc_discovery_engagement, asc_raw_rows,
--         asc_report_instances, asc_report_requests, asc_reports,
--         asc_report_segments, asc_sync_status
select indexname from pg_indexes where schemaname='public' and tablename in
  ('asc_discovery_engagement','asc_downloads');
select pg_get_viewdef('public.asc_conversion_daily', true);
select relrowsecurity from pg_class where relname='asc_downloads'; -- expect: t
```

- [ ] **Step 5: Sentinel idempotency check** (proves the NULLS NOT DISTINCT fix). Insert the same row twice with a NULL dimension; assert one row.
```sql
insert into public.asc_downloads (reporting_date, source_type, channel, counts, unique_counts)
values ('2026-06-01', null, 'app_store_search', 10, 8)
on conflict do nothing;
insert into public.asc_downloads (reporting_date, source_type, channel, counts, unique_counts)
values ('2026-06-01', null, 'app_store_search', 10, 8)
on conflict do nothing;
select count(*) from public.asc_downloads where reporting_date='2026-06-01'; -- expect: 1
delete from public.asc_downloads where reporting_date='2026-06-01'; -- cleanup
```
Expected: `count = 1`. If `2`, the unique constraint lacks `NULLS NOT DISTINCT` — fix before proceeding.

- [ ] **Step 6: Commit**
```bash
git add supabase/migrations/*app_store_connect_analytics_phase1.sql
git commit -m "feat(admin): app store connect analytics schema (asc_* tables, conversion view, RLS)"
```

---

## Task 2: ASC client — config guard + ES256 JWT mint

**Files:**
- Create: `src/lib/analytics/app-store-client.ts`
- Test: `tests/unit/app-store-client.test.ts`

- [ ] **Step 1: Write the failing test**
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { importPKCS8, jwtVerify, decodeProtectedHeader } from "jose";
import { isAppStoreConfigured, mintToken } from "@/lib/analytics/app-store-client";

// A throwaway ES256 (P-256) PKCS8 key generated for tests only.
const TEST_P8 = `-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg... (replace with a real test key) ...\n-----END PRIVATE KEY-----`;

describe("isAppStoreConfigured", () => {
  beforeEach(() => {
    delete process.env.ASC_KEY_ID; delete process.env.ASC_ISSUER_ID;
    delete process.env.ASC_PRIVATE_KEY; delete process.env.ASC_APP_ID;
  });
  it("false when any var missing", () => { expect(isAppStoreConfigured()).toBe(false); });
  it("true when all set", () => {
    process.env.ASC_KEY_ID = "K"; process.env.ASC_ISSUER_ID = "I";
    process.env.ASC_PRIVATE_KEY = "P"; process.env.ASC_APP_ID = "123";
    expect(isAppStoreConfigured()).toBe(true);
  });
});

describe("mintToken", () => {
  beforeEach(() => {
    process.env.ASC_KEY_ID = "ABC123KEYID";
    process.env.ASC_ISSUER_ID = "11111111-2222-3333-4444-555555555555";
    process.env.ASC_PRIVATE_KEY = TEST_P8;
  });
  it("signs an ES256 JWT with the right header + claims and exp <= 20min", async () => {
    const token = await mintToken();
    const header = decodeProtectedHeader(token);
    expect(header.alg).toBe("ES256");
    expect(header.kid).toBe("ABC123KEYID");
    const pub = await importPKCS8(TEST_P8, "ES256"); // verify with the same key (test only)
    const { payload } = await jwtVerify(token, await importPKCS8(TEST_P8, "ES256"), {
      audience: "appstoreconnect-v1",
    }).catch(async () => {
      // ES256 verify needs the public key; for the unit test assert claims via decode instead
      const [, body] = token.split(".");
      return { payload: JSON.parse(Buffer.from(body, "base64url").toString()) } as never;
    });
    expect(payload.iss).toBe("11111111-2222-3333-4444-555555555555");
    expect(payload.aud).toBe("appstoreconnect-v1");
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(1200);
  });
});
```
> Note for the implementing subagent: generate a real throwaway P-256 PKCS8 key with `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 | openssl pkcs8 -topk8 -nocrypt` and paste it as `TEST_P8`. Assert header via `decodeProtectedHeader` and claims via base64url-decoding the payload (simplest, no public-key handling needed).

- [ ] **Step 2: Run test to verify it fails** — `npm test -- app-store-client` → FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/analytics/app-store-client.ts`**
```typescript
import { SignJWT, importPKCS8 } from "jose";
import { parsePrivateKey } from "@/lib/firebase/parse-private-key";

const ASC_BASE = "https://api.appstoreconnect.apple.com";
const AUD = "appstoreconnect-v1";

export function isAppStoreConfigured(): boolean {
  return !!(
    process.env.ASC_KEY_ID &&
    process.env.ASC_ISSUER_ID &&
    process.env.ASC_PRIVATE_KEY &&
    process.env.ASC_APP_ID
  );
}

export function getAscAppId(): string {
  const id = process.env.ASC_APP_ID;
  if (!id) throw new Error("Missing ASC_APP_ID");
  return id;
}

export async function mintToken(): Promise<string> {
  const kid = process.env.ASC_KEY_ID;
  const iss = process.env.ASC_ISSUER_ID;
  const pem = parsePrivateKey(process.env.ASC_PRIVATE_KEY);
  if (!kid || !iss || !pem) throw new Error("App Store Connect not configured");
  const key = await importPKCS8(pem, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
    .setIssuer(iss)
    .setIssuedAt(now)
    .setExpirationTime(now + 1140) // 19 min (<= 20 min hard cap)
    .setAudience(AUD)
    .sign(key);
}

export interface AscFetchOpts { token?: string; }

export async function ascGet<T = unknown>(path: string, opts: AscFetchOpts = {}): Promise<T> {
  const token = opts.token ?? (await mintToken());
  const url = path.startsWith("http") ? path : `${ASC_BASE}${path}`;
  const res = await fetchWithBackoff(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`ASC GET ${path} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function ascPost<T = unknown>(path: string, body: unknown, opts: AscFetchOpts = {}): Promise<T> {
  const token = opts.token ?? (await mintToken());
  const res = await fetchWithBackoff(`${ASC_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ASC POST ${path} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** Download a signed segment URL and gunzip → string. */
export async function downloadSegment(url: string): Promise<string> {
  const res = await fetchWithBackoff(url, {});
  if (!res.ok) throw new Error(`segment download -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { gunzipSync } = await import("node:zlib");
  return gunzipSync(buf).toString("utf8");
}

async function fetchWithBackoff(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 429 && attempt < 4) {
    const wait = Math.min(2000 * 2 ** attempt, 30_000) + Math.floor(Math.random() * 500);
    await new Promise((r) => setTimeout(r, wait));
    return fetchWithBackoff(url, init, attempt + 1);
  }
  return res;
}
```

- [ ] **Step 4: Run test to verify it passes** — `npm test -- app-store-client` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/analytics/app-store-client.ts tests/unit/app-store-client.test.ts
git commit -m "feat(admin): app store connect client (ES256 JWT mint + ASC fetch/backoff)"
```

---

## Task 3: TSV parser + channel mapping

**Files:**
- Create: `src/lib/analytics/app-store-parse.ts`
- Test: `tests/unit/app-store-parse.test.ts`

- [ ] **Step 1: Write the failing test** (the highest-value test — column drift + channel map)
```typescript
import { describe, it, expect } from "vitest";
import { parseTsv, mapAppStoreSourceToChannel } from "@/lib/analytics/app-store-parse";

describe("mapAppStoreSourceToChannel", () => {
  it.each([
    ["App Store Search", "app_store_search"],
    ["App Store Browse", "app_store_browse"],
    ["App Referrer", "app_referrer"],
    ["Web Referrer", "web_referrer"],
    ["App Clip", "app_clip"],
    ["Institutional Purchase", "institutional"],
    ["Unavailable", "unavailable"],
    ["", "unavailable"],
    ["Something New", "other"],
  ])("maps %s -> %s", (src, expected) => {
    expect(mapAppStoreSourceToChannel(src, null)).toBe(expected);
  });
});

describe("parseTsv (header-name based, drift-tolerant)", () => {
  const canonicalAliases = {
    reporting_date: ["date"], source_type: ["source type"],
    counts: ["counts"], unique_counts: ["unique counts", "unique devices"],
  };
  it("maps documented header order", () => {
    const tsv = "Date\tSource Type\tCounts\tUnique Counts\n2026-06-01\tApp Store Search\t1,234\t1000";
    const rows = parseTsv(tsv, canonicalAliases);
    expect(rows[0]).toMatchObject({ reporting_date: "2026-06-01", source_type: "App Store Search", counts: 1234, unique_counts: 1000 });
  });
  it("survives reordered columns", () => {
    const tsv = "Unique Counts\tCounts\tSource Type\tDate\n5\t9\tApp Store Browse\t2026-06-02";
    const rows = parseTsv(tsv, canonicalAliases);
    expect(rows[0]).toMatchObject({ counts: 9, unique_counts: 5, source_type: "App Store Browse" });
  });
  it("keeps unknown columns in raw and never drops them", () => {
    const tsv = "Date\tSource Type\tCounts\tNew Apple Column\n2026-06-03\tWeb Referrer\t3\tXYZ";
    const rows = parseTsv(tsv, canonicalAliases);
    expect(rows[0].raw["new apple column"]).toBe("XYZ");
  });
  it("handles 'Unique Devices' alias for unique_counts", () => {
    const tsv = "Date\tSource Type\tCounts\tUnique Devices\n2026-06-04\tApp Store Search\t7\t4";
    const rows = parseTsv(tsv, canonicalAliases);
    expect(rows[0].unique_counts).toBe(4);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `npm test -- app-store-parse`.

- [ ] **Step 3: Implement `src/lib/analytics/app-store-parse.ts`**
```typescript
export type AscChannel =
  | "app_store_search" | "app_store_browse" | "app_referrer" | "web_referrer"
  | "app_clip" | "institutional" | "unavailable" | "other";

export function mapAppStoreSourceToChannel(sourceType: string | null, _info: string | null): AscChannel {
  const s = (sourceType ?? "").trim().toLowerCase();
  if (s === "") return "unavailable";
  if (s === "app store search") return "app_store_search";
  if (s === "app store browse") return "app_store_browse";
  if (s === "app referrer") return "app_referrer";
  if (s === "web referrer") return "web_referrer";
  if (s === "app clip") return "app_clip";
  if (s === "institutional purchase") return "institutional";
  if (s === "unavailable") return "unavailable";
  return "other";
}

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

export interface ParsedRow {
  [canonical: string]: string | number | Record<string, string>;
  raw: Record<string, string>;
}

/** aliases: canonicalName -> list of normalized header aliases (besides the canonical name itself). */
export function parseTsv(text: string, aliases: Record<string, string[]>): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t").map(norm);
  // Build canonical -> column index
  const numericCanon = new Set(["counts", "unique_counts"]);
  const resolve: Record<string, number> = {};
  for (const [canon, alist] of Object.entries(aliases)) {
    const candidates = [norm(canon.replace(/_/g, " ")), ...alist.map(norm)];
    const idx = headers.findIndex((h) => candidates.includes(h));
    if (idx >= 0) resolve[canon] = idx;
  }
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => { raw[h] = cells[i] ?? ""; });
    const out: ParsedRow = { raw };
    for (const [canon, idx] of Object.entries(resolve)) {
      const v = (cells[idx] ?? "").trim();
      out[canon] = numericCanon.has(canon) ? parseNum(v) : v;
    }
    return out;
  });
}

function parseNum(v: string): number {
  const n = Number(v.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
```

- [ ] **Step 4: Run → PASS** — `npm test -- app-store-parse`.

- [ ] **Step 5: Commit**
```bash
git add src/lib/analytics/app-store-parse.ts tests/unit/app-store-parse.test.ts
git commit -m "feat(admin): app store TSV header-name parser + channel mapping"
```

---

## Task 4: Sync status queries + read query fns + types

**Files:**
- Create: `src/lib/admin/app-store-queries.ts`
- Test: `tests/unit/app-store-queries.test.ts`

- [ ] **Step 1: Write failing test for the cache-key regression guard + range parsing helper**
```typescript
import { describe, it, expect } from "vitest";
import { ascCacheKey } from "@/lib/admin/app-store-queries";

describe("ascCacheKey", () => {
  it("includes from/to/granularity so dated variants never collide", () => {
    const a = ascCacheKey("kpis", "2026-06-01", "2026-06-30", "daily");
    const b = ascCacheKey("kpis", "2026-05-01", "2026-05-31", "daily");
    expect(a).not.toEqual(b);
    expect(a).toEqual(["asc", "kpis", "2026-06-01", "2026-06-30", "daily"]);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/lib/admin/app-store-queries.ts`** — status helpers + the cache-key helper + 5 cached read fns. Status helpers mirror `updateSyncStatus` in `ads-history-queries.ts`. **Every cached read fn includes `from/to/granularity` in the key array** (do NOT replicate the `admin-queries.ts` static-key bug).
```typescript
import { unstable_cache } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

const db = () => getAdminSupabase();

export type AscGranularity = "daily" | "weekly" | "monthly";
export interface AscSyncStatus {
  job_name: string; status: "idle" | "running" | "complete" | "failed";
  last_synced_date: string | null; last_run_at: string | null; error: string | null;
}

export async function getAscSyncStatus(job = "app-store-sync"): Promise<AscSyncStatus | null> {
  const { data } = await db().from("asc_sync_status").select("*").eq("job_name", job).maybeSingle();
  return data as AscSyncStatus | null;
}
export async function updateAscSyncStatus(job: string, patch: Partial<Omit<AscSyncStatus, "job_name">>): Promise<void> {
  await db().from("asc_sync_status").upsert(
    { job_name: job, ...patch, last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: "job_name" },
  );
}

export function ascCacheKey(...parts: (string | number)[]): string[] {
  return ["asc", ...parts.map(String)];
}

export interface AscKpis {
  conversionRate: number | null; impressions: number; pageViews: number; downloads: number;
  prev: { conversionRate: number | null; impressions: number; pageViews: number; downloads: number };
  finalizedThrough: string; // current_date - 2
  hasData: boolean;
}

// KPIs: current range + immediately-preceding equal-length range, from the view + facts.
async function _kpis(from: string, to: string): Promise<AscKpis> {
  // Implementation: query asc_conversion_daily for downloads + unique_impressions over [from,to]
  // and the preceding range; query asc_discovery_engagement for impressions (unique_counts where
  // engagement ~ impression) and page views (counts where engagement ~ product page view).
  // conversionRate = downloads / unique_impressions (null when denom 0). Compute finalizedThrough.
  // Return hasData=false when no rows in range.
  // (Full SQL in spec §A7.3; use db().rpc or .select with filters + JS reduce.)
  throw new Error("implement per spec §A7.3");
}
export const getAscKpis = (from: string, to: string) =>
  unstable_cache(() => _kpis(from, to), ascCacheKey("kpis", from, to), { revalidate: 300 })();

// conversion-series, traffic-series, source-breakdown, territories follow the SAME shape:
//   export const getAscConversionSeries = (from,to,g) =>
//     unstable_cache(() => _conversionSeries(from,to,g), ascCacheKey("conv", from, to, g), {revalidate:300})();
// Each _fn() reads the relevant table/view, buckets via bucketize() from date-utils, returns
// ChartDataPoint[] / DonutSegment[] / TerritoryRow[]. provisional computed at read time:
//   reporting_date > current_date - 2.
```
> Implementing subagent: flesh out `_kpis` and the four series fns against the real columns (spec §A7.3–A7.7). Reuse `bucketize`/`bucketizeAggregate` from `src/lib/admin/date-utils.ts`. Keep each `_fn` ≤ ~40 lines; if longer, the query is doing too much — split.

- [ ] **Step 4: Run → PASS** (the `ascCacheKey` test; the read fns get integration coverage in Task 6 fixtures).

- [ ] **Step 5: Commit**
```bash
git add src/lib/admin/app-store-queries.ts tests/unit/app-store-queries.test.ts
git commit -m "feat(admin): app store sync-status + cached read queries (args in cache key)"
```

---

## Task 5: Sync pipeline (bootstrap + 6-step pull + idempotent upsert)

**Files:**
- Create: `src/lib/admin/app-store-sync.ts`
- Test: `tests/unit/app-store-sync.test.ts`

- [ ] **Step 1: Write the failing test** — mock the ASC client + Supabase; assert (a) bootstrap creates ONGOING + SNAPSHOT once, (b) a processed segment checksum is skipped on re-run, (c) parsed rows upsert with mapped `channel`, (d) trailing-3-day re-pull updates in place. Use `vi.mock("@/lib/analytics/app-store-client", ...)` returning recorded fixtures (requests → reports → instances → segments → gz string).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `src/lib/admin/app-store-sync.ts`**
  - `bootstrapIfNeeded()` — if `asc_report_requests` empty, `ascPost("/v1/analyticsReportRequests", {data:{type:"analyticsReportRequests", attributes:{accessType}, relationships:{app:{data:{type:"apps", id: getAscAppId()}}}}})` for `ONGOING` then `ONE_TIME_SNAPSHOT`; persist ids. Guard: skip SNAPSHOT if one exists < 31 days old.
  - `syncOnce()` — for each active request: list reports (filter category `APP_STORE_ENGAGEMENT`, `APP_STORE_COMMERCE`) → instances (`granularity=DAILY`, paginate via `links.next`) → segments → for each unprocessed checksum: `downloadSegment` → `parseTsv(text, ALIASES)` → map source→channel → land `asc_raw_rows` → upsert facts (`onConflict` on the unique constraint, `ignoreDuplicates:false` so it UPDATEs) → mark segment `processed`. Re-pull trailing 3 reporting dates each run.
  - Define `ENGAGEMENT_ALIASES` / `DOWNLOAD_ALIASES` from spec §A5.
  - Write `updateAscSyncStatus` running/complete/failed + `last_synced_date`.
> Keep the file focused on orchestration; parsing lives in Task 3, HTTP in Task 2.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**
```bash
git add src/lib/admin/app-store-sync.ts tests/unit/app-store-sync.test.ts
git commit -m "feat(admin): app store sync pipeline (bootstrap + 6-step pull + idempotent upsert)"
```

---

## Task 6: Cron route

**Files:**
- Create: `src/app/api/cron/app-store-sync/route.ts`

- [ ] **Step 1: Write test** (`tests/unit/app-store-sync.test.ts` addition or a route test) — wrong/empty `CRON_SECRET` → 401; correct → calls `bootstrapIfNeeded` + `syncOnce`.

- [ ] **Step 2: Implement** (mirror `ads-sync/route.ts` exactly)
```typescript
import { NextRequest, NextResponse } from "next/server";
import { bootstrapIfNeeded, syncOnce } from "@/lib/admin/app-store-sync";
import { updateAscSyncStatus } from "@/lib/admin/app-store-queries";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await updateAscSyncStatus("app-store-sync", { status: "running", error: null });
    await bootstrapIfNeeded();
    const result = await syncOnce();
    await updateAscSyncStatus("app-store-sync", { status: "complete", last_synced_date: result.lastDate, error: null });
    return NextResponse.json({ status: "synced", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateAscSyncStatus("app-store-sync", { status: "failed", error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Run tests → PASS.**

- [ ] **Step 4: Add the cron to `vercel.json`** — after the `ads-sync` object, insert `{ "path": "/api/cron/app-store-sync", "schedule": "0 9 * * *" }`.

- [ ] **Step 5: Commit**
```bash
git add src/app/api/cron/app-store-sync/route.ts vercel.json
git commit -m "feat(admin): app store daily sync cron (09:00 UTC, CRON_SECRET guarded)"
```

---

## Task 7: Read API routes (5)

**Files:**
- Create: `src/app/api/admin/app-store/{kpis,conversion-series,traffic-series,source-breakdown,territories}/route.ts`

- [ ] **Step 1: Implement each route** (uniform; example `kpis`)
```typescript
import { NextRequest, NextResponse } from "next/server";
import { withAdmin, requireAdmin } from "@/lib/admin/api-auth";
import { getAscKpis } from "@/lib/admin/app-store-queries";

function parseRange(req: NextRequest) {
  const u = new URL(req.url);
  const to = u.searchParams.get("to") ?? new Date().toISOString();
  const from = u.searchParams.get("from") ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const granularity = (u.searchParams.get("granularity") ?? "daily") as "daily" | "weekly" | "monthly";
  return { from, to, granularity };
}

export const GET = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const { from, to } = parseRange(req);
  const data = await getAscKpis(from, to);
  return NextResponse.json({ data });
});
```
The other four call their respective query fn with `(from, to, granularity)`.

- [ ] **Step 2: Test** — non-admin (no `DEV_BYPASS_AUTH`, no admin cookie) → 403; admin → 200 with `{ data }`. (Reuse the admin-route test harness if present; otherwise assert `requireAdmin` throws 403 via a mocked `isAdminEmail` → false.)

- [ ] **Step 3: Commit**
```bash
git add src/app/api/admin/app-store
git commit -m "feat(admin): app store read API routes (kpis/series/source/territories)"
```

---

## Task 8: The `Growth > App Store` page (RSC + content)

**Files:**
- Create: `src/app/admin/app-store/page.tsx`, `src/app/admin/app-store/_components/app-store-content.tsx`

> **Invoke the design-skill stack for this task** (frontend-design + interface-design + ops-design token reads + ops-copywriter). Reuse `AdminPageHeader`, `StatCard`, `AdminLineChart`, `AdminDonutChart`, `FunnelChart`, `Sparkline`, `SortableTableHeader`/`useSortState`, `DateRangeControl`/`useDateRange`. Numbers JetBrains Mono tabular; empty `—`; accent NEVER on a data series.

- [ ] **Step 1: RSC `page.tsx`** — mirror `app-analytics/page.tsx`: `isAppStoreConfigured()` false → render SETUP REQUIRED card (mirror the Google Ads setup card). Else `try/catch` fetch default (last 30d daily) via `Promise.all` of the query fns; on empty + no processed instance → AWAITING FIRST APPLE REPORT panel (query `getAscSyncStatus` + an instance-count check); pass `initialData` to `<AppStoreContent>`. `AdminPageHeader title="APP STORE" caption="APP STORE CONNECT · ACQUISITION FUNNEL"`, plus `COMPLETE THROUGH {finalizedThrough}`.

- [ ] **Step 2: `app-store-content.tsx` (`'use client'`)** — `DateRangeControl` + `useDateRange("30d")`; TanStack `useQuery` per section keyed `["asc-kpis", from, to]` etc., seeded with `initialData` when params match the RSC default; render: KPI row (4 `StatCard`s with period-over-period `trend` + `sparklineData`), conversion-rate `AdminLineChart` (hero; provisional points muted), traffic `AdminLineChart`/stacked (impressions vs page views vs downloads) + optional `FunnelChart`, source `AdminDonutChart` by channel (legend footnote "App Store Search includes Apple Search Ads"), territory table (`SortableTableHeader` + `useSortState("downloads")`, inline `Sparkline` per row). Provisional banner when range right edge < 2 days.

- [ ] **Step 3: Manual verify in preview** (see Proof section) — page renders all three states (setup-required, awaiting, populated-with-fixture).

- [ ] **Step 4: Commit**
```bash
git add src/app/admin/app-store
git commit -m "feat(admin): Growth > App Store page (conversion funnel, source, territories)"
```

---

## Task 9: Sidebar nav + Kosugi font fix

**Files:**
- Modify: `src/app/admin/_components/sidebar.tsx`, `src/app/admin/_components/charts/line-chart.tsx`, `charts/bar-chart.tsx`

- [ ] **Step 1:** Insert after the GOOGLE ADS entry (after line 14):
```typescript
  { type: "item", href: "/admin/app-store", label: "APP STORE" },
```
- [ ] **Step 2:** In `line-chart.tsx` (lines 52, 57) and `bar-chart.tsx`, replace `fontFamily: "Kosugi"` → `fontFamily: "JetBrains Mono"`.
- [ ] **Step 3: Verify** the sidebar shows APP STORE under GROWTH after GOOGLE ADS in the preview.
- [ ] **Step 4: Commit**
```bash
git add src/app/admin/_components/sidebar.tsx src/app/admin/_components/charts/line-chart.tsx src/app/admin/_components/charts/bar-chart.tsx
git commit -m "feat(admin): register App Store nav + retire Kosugi font in admin charts"
```

---

## Task 10: Full test sweep + typecheck

- [ ] **Step 1:** `npm test -- app-store` → all pass.
- [ ] **Step 2:** `npx tsc --noEmit` (or the project's typecheck script) → no new errors in `app-store*` files. (CI lint is known-red on unrelated pre-existing issues — verify only that our files are clean.)
- [ ] **Step 3: Commit** any fixes.

---

## Post-build (gated on Jackson's credential — not blocking the build)

- [ ] **Live validation #13/#14** (spec §A9): after Jackson adds `ASC_KEY_ID/ASC_ISSUER_ID/ASC_PRIVATE_KEY/ASC_APP_ID` to Vercel and Apple unlocks analytics (~24–48h), trigger the cron once, download one real segment, **byte-confirm header strings + pin the Unique-Impressions denominator and the download summation rule**, then adjust `ENGAGEMENT_ALIASES`/`DOWNLOAD_ALIASES` and the conversion view if needed. Spot-check one date vs the App Store Connect dashboard.

---

## Self-Review (run by author)

- **Spec coverage:** Tasks 1–10 cover spec §A1–A9 (prereqs/secrets handled via env + `isAppStoreConfigured`; A2 JWT=Task2; A3 pipeline=Task5; A3.5 cron=Task6; A4 schema=Task1; A5 parser=Task3; A6 channel map=Task3; A7 page=Task8; A8 routes=Task7+sync-status Task4; A9 tests across 2/3/5/6/7 + post-build live validation). North-star/roadmap (Parts B–E) are future phases, intentionally out of this plan.
- **Placeholders:** The only deferred detail is the body of `_kpis`/series read fns (Task 4 Step 3) and the Task 5 sync internals — both have explicit per-spec instructions + exact tables/columns, not "TODO". Acceptable as bite-sized implementer work with concrete references.
- **Type consistency:** `AscChannel`, `AscGranularity`, `AscKpis`, `ParsedRow`, `mintToken`/`ascGet`/`ascPost`/`downloadSegment`, `getAscKpis`, `updateAscSyncStatus`/`getAscSyncStatus`, `ascCacheKey`, `bootstrapIfNeeded`/`syncOnce` are named identically wherever referenced across tasks.
- **Idempotency fix** verified by Task 1 Step 5 sentinel; **provisional** is read-time everywhere; **`asc_sync_status`** defined in Task 1 and used in Tasks 4/6.
