import {
  ascGet,
  ascPost,
  downloadSegment,
  getAscAppId,
} from "@/lib/analytics/app-store-client";
import { parseTsv, mapAppStoreSourceToChannel, type ParsedRow } from "@/lib/analytics/app-store-parse";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

// ─── Apple report categories we ingest in Phase 1 ────────────────────────────
const CATEGORY_ENGAGEMENT = "APP_STORE_ENGAGEMENT"; // impressions + product page views
const CATEGORY_COMMERCE = "APP_STORE_COMMERCE"; // downloads

// Header aliases (normalized: lowercase, single-spaced). Canonical name itself is
// always tried (with underscores → spaces), so only ADDITIONAL aliases go here.
const ENGAGEMENT_ALIASES: Record<string, string[]> = {
  reporting_date: ["date"],
  engagement_type: ["engagement type", "event", "event type"],
  page_type: ["page type"],
  source_type: ["source type"],
  source_info: ["source info", "source"],
  device: ["device"],
  platform_version: ["platform version"],
  territory: ["territory", "country / region", "country/region"],
  counts: ["counts"],
  unique_counts: ["unique counts", "unique devices"],
};

const DOWNLOAD_ALIASES: Record<string, string[]> = {
  reporting_date: ["date"],
  download_type: ["download type"],
  page_type: ["page type"],
  source_type: ["source type"],
  source_info: ["source info", "source"],
  campaign: ["campaign"],
  device: ["device"],
  platform_version: ["platform version"],
  territory: ["territory", "country / region", "country/region"],
  counts: ["counts", "downloads"],
  unique_counts: ["unique counts", "unique devices"],
};

const db = () => getAdminSupabase();

const str = (r: ParsedRow, k: string): string | null => {
  const v = r[k];
  return typeof v === "string" && v.length > 0 ? v : null;
};
const num = (r: ParsedRow, k: string): number => (typeof r[k] === "number" ? (r[k] as number) : 0);

// ─── Pure transforms (unit-tested) ───────────────────────────────────────────

/** Build the ASC report-request POST body for an app + access type. */
export function buildReportRequestBody(accessType: "ONGOING" | "ONE_TIME_SNAPSHOT", appId: string) {
  return {
    data: {
      type: "analyticsReportRequests",
      attributes: { accessType },
      relationships: { app: { data: { type: "apps", id: appId } } },
    },
  };
}

/** Map a parsed Discovery & Engagement row → asc_discovery_engagement record. */
export function toEngagementFact(r: ParsedRow, segmentId: string) {
  const source_type = str(r, "source_type");
  return {
    granularity: "DAILY",
    reporting_date: str(r, "reporting_date"),
    engagement_type: str(r, "engagement_type"),
    page_type: str(r, "page_type"),
    source_type,
    source_info: str(r, "source_info"),
    device: str(r, "device"),
    platform_version: str(r, "platform_version"),
    territory: str(r, "territory"),
    channel: mapAppStoreSourceToChannel(source_type, str(r, "source_info")),
    counts: num(r, "counts"),
    unique_counts: num(r, "unique_counts"),
    segment_id: segmentId,
    updated_at: new Date().toISOString(),
  };
}

/** Map a parsed Downloads row → asc_downloads record. */
export function toDownloadFact(r: ParsedRow, segmentId: string) {
  const source_type = str(r, "source_type");
  return {
    granularity: "DAILY",
    reporting_date: str(r, "reporting_date"),
    download_type: str(r, "download_type"),
    page_type: str(r, "page_type"),
    source_type,
    source_info: str(r, "source_info"),
    campaign: str(r, "campaign"),
    device: str(r, "device"),
    platform_version: str(r, "platform_version"),
    territory: str(r, "territory"),
    channel: mapAppStoreSourceToChannel(source_type, str(r, "source_info")),
    counts: num(r, "counts"),
    unique_counts: num(r, "unique_counts"),
    segment_id: segmentId,
    updated_at: new Date().toISOString(),
  };
}

const ENGAGEMENT_CONFLICT =
  "granularity,reporting_date,engagement_type,page_type,source_type,source_info,device,platform_version,territory";
const DOWNLOAD_CONFLICT =
  "granularity,reporting_date,download_type,page_type,source_type,source_info,campaign,device,platform_version,territory";

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const SNAPSHOT_COOLDOWN_MS = 31 * 86_400_000;

/**
 * On first run, register an ONGOING report request (daily forward) and a
 * ONE_TIME_SNAPSHOT (all history). Idempotent: never duplicates an existing
 * request, and won't re-fire a snapshot younger than ~31 days.
 */
export async function bootstrapIfNeeded(): Promise<void> {
  const appId = getAscAppId();
  const client = db();
  const { data: existing } = await client
    .from("asc_report_requests")
    .select("access_type, created_at");
  const rows = (existing ?? []) as { access_type: string; created_at: string }[];

  if (!rows.some((r) => r.access_type === "ONGOING")) {
    await createRequest("ONGOING", appId);
  }

  const snap = rows.find((r) => r.access_type === "ONE_TIME_SNAPSHOT");
  const snapFresh = snap && Date.now() - new Date(snap.created_at).getTime() < SNAPSHOT_COOLDOWN_MS;
  if (!snap || !snapFresh) {
    if (!snap) await createRequest("ONE_TIME_SNAPSHOT", appId);
  }
}

async function createRequest(accessType: "ONGOING" | "ONE_TIME_SNAPSHOT", appId: string): Promise<void> {
  const res = await ascPost<{ data: { id: string } }>(
    "/v1/analyticsReportRequests",
    buildReportRequestBody(accessType, appId),
  );
  await db().from("asc_report_requests").insert({
    asc_request_id: res.data.id,
    app_id: appId,
    access_type: accessType,
  });
}

// ─── Sync ────────────────────────────────────────────────────────────────────

interface ListResponse<A> {
  data: { id: string; attributes: A }[];
  links?: { next?: string };
}

async function listAll<A>(firstPath: string): Promise<{ id: string; attributes: A }[]> {
  const out: { id: string; attributes: A }[] = [];
  let next: string | undefined = firstPath;
  while (next) {
    const page: ListResponse<A> = await ascGet<ListResponse<A>>(next);
    out.push(...page.data);
    next = page.links?.next;
  }
  return out;
}

export interface SyncResult {
  segmentsProcessed: number;
  rowsIngested: number;
  lastDate: string | null;
}

/**
 * Run the full pull for every active report request. Idempotent: segments whose
 * checksum is already processed are skipped; fact upserts (ON CONFLICT DO UPDATE)
 * absorb Apple's +2-day restatement, so re-pulling recent dates is safe.
 */
export async function syncOnce(): Promise<SyncResult> {
  const client = db();
  const { data: requests } = await client
    .from("asc_report_requests")
    .select("id, asc_request_id, stopped_at")
    .is("stopped_at", null);

  let segmentsProcessed = 0;
  let rowsIngested = 0;
  let lastDate: string | null = null;

  for (const req of (requests ?? []) as { id: string; asc_request_id: string }[]) {
    for (const [category, kind, aliases, table, conflict] of [
      [CATEGORY_ENGAGEMENT, "discovery_engagement", ENGAGEMENT_ALIASES, "asc_discovery_engagement", ENGAGEMENT_CONFLICT],
      [CATEGORY_COMMERCE, "downloads", DOWNLOAD_ALIASES, "asc_downloads", DOWNLOAD_CONFLICT],
    ] as const) {
      const reports = await listAll<{ category: string; name?: string }>(
        `/v1/analyticsReportRequests/${req.asc_request_id}/reports?filter[category]=${category}&limit=200`,
      );
      for (const report of reports) {
        const { data: reportRow } = await client
          .from("asc_reports")
          .upsert(
            { request_id: req.id, asc_report_id: report.id, category, report_name: report.attributes.name ?? null },
            { onConflict: "asc_report_id" },
          )
          .select("id")
          .single();
        const reportRowId = (reportRow as { id: string } | null)?.id;
        if (!reportRowId) continue;

        const instances = await listAll<{ granularity: string; processingDate: string }>(
          `/v1/analyticsReports/${report.id}/instances?filter[granularity]=DAILY&limit=200`,
        );
        for (const inst of instances) {
          const { data: instRow } = await client
            .from("asc_report_instances")
            .upsert(
              {
                report_id: reportRowId,
                asc_instance_id: inst.id,
                granularity: inst.attributes.granularity ?? "DAILY",
                processing_date: inst.attributes.processingDate,
              },
              { onConflict: "asc_instance_id" },
            )
            .select("id")
            .single();
          const instRowId = (instRow as { id: string } | null)?.id;
          if (!instRowId) continue;

          const segments = await listAll<{ checksum: string; sizeInBytes?: number; url: string }>(
            `/v1/analyticsReportInstances/${inst.id}/segments?limit=200`,
          );
          for (const seg of segments) {
            // Skip already-processed segment (idempotency on checksum).
            const { data: segExisting } = await client
              .from("asc_report_segments")
              .select("id, state")
              .eq("instance_id", instRowId)
              .eq("checksum", seg.attributes.checksum)
              .maybeSingle();
            if ((segExisting as { state: string } | null)?.state === "processed") continue;

            const { data: segRow } = await client
              .from("asc_report_segments")
              .upsert(
                {
                  instance_id: instRowId,
                  checksum: seg.attributes.checksum,
                  size_bytes: seg.attributes.sizeInBytes ?? null,
                  url: seg.attributes.url,
                  state: "discovered",
                },
                { onConflict: "instance_id,checksum" },
              )
              .select("id")
              .single();
            const segRowId = (segRow as { id: string } | null)?.id;
            if (!segRowId) continue;

            const text = await downloadSegment(seg.attributes.url);
            const parsed = parseTsv(text, aliases);

            if (parsed.length > 0) {
              await client.from("asc_raw_rows").insert(
                parsed.map((r) => ({
                  segment_id: segRowId,
                  report_kind: kind,
                  reporting_date: (r.reporting_date as string) ?? inst.attributes.processingDate,
                  raw: r.raw,
                })),
              );
              const facts = parsed
                .map((r) => (kind === "discovery_engagement" ? toEngagementFact(r, segRowId) : toDownloadFact(r, segRowId)))
                .filter((f) => f.reporting_date);
              if (facts.length > 0) {
                await client.from(table).upsert(facts, { onConflict: conflict });
              }
              rowsIngested += facts.length;
            }

            await client
              .from("asc_report_segments")
              .update({ state: "processed", rows_ingested: parsed.length, processed_at: new Date().toISOString() })
              .eq("id", segRowId);
            await client
              .from("asc_report_instances")
              .update({ state: "processed", processed_at: new Date().toISOString() })
              .eq("id", instRowId);

            segmentsProcessed += 1;
            if (!lastDate || inst.attributes.processingDate > lastDate) lastDate = inst.attributes.processingDate;
          }
        }
      }
    }
  }

  return { segmentsProcessed, rowsIngested, lastDate };
}
