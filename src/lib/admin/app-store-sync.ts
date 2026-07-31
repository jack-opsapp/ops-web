import {
  ascGet,
  ascPost,
  downloadSegment,
  getAscAppId,
} from "@/lib/analytics/app-store-client";
import { parseTsv, mapAppStoreSourceToChannel, type ParsedRow } from "@/lib/analytics/app-store-parse";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import {
  advanceCronWorkloadCursor,
  readCronWorkloadCursor,
} from "@/lib/api/services/cron-workload-cursor-service";
import {
  CronDatabaseOperationError,
  type CronWorkloadLease,
} from "@/lib/api/services/cron-workload-control-service";

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
type AdminClient = ReturnType<typeof getAdminSupabase>;

interface DatabaseResult<T> {
  data: T;
  error: unknown;
}

async function checkedDatabaseResult<T>(
  operation: string,
  pending: PromiseLike<DatabaseResult<T>>
): Promise<T> {
  let result: DatabaseResult<T>;
  try {
    result = await pending;
  } catch (cause) {
    throw new CronDatabaseOperationError(
      `App Store ${operation} was unreachable`,
      { cause }
    );
  }
  if (result.error) {
    throw new CronDatabaseOperationError(
      `App Store ${operation} failed`,
      { cause: result.error }
    );
  }
  return result.data;
}

function requireDatabaseRow<T>(
  operation: string,
  row: T | null
): T {
  if (row !== null) return row;
  throw new CronDatabaseOperationError(
    `App Store ${operation} returned no row`,
    { cause: new Error("checked database write returned no row") }
  );
}

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
export async function bootstrapIfNeeded(client: AdminClient = db()): Promise<void> {
  const appId = getAscAppId();
  const existing = await checkedDatabaseResult<
    { access_type: string; created_at: string }[] | null
  >(
    "report-request bootstrap read",
    client
      .from("asc_report_requests")
      .select("access_type, created_at")
      .order("created_at", { ascending: false })
      .limit(2)
  );
  const rows = (existing ?? []) as { access_type: string; created_at: string }[];

  if (!rows.some((r) => r.access_type === "ONGOING")) {
    await createRequest("ONGOING", appId, client);
    return;
  }

  const snap = rows.find((r) => r.access_type === "ONE_TIME_SNAPSHOT");
  const snapFresh = snap && Date.now() - new Date(snap.created_at).getTime() < SNAPSHOT_COOLDOWN_MS;
  if (!snap || !snapFresh) {
    if (!snap) await createRequest("ONE_TIME_SNAPSHOT", appId, client);
  }
}

async function createRequest(
  accessType: "ONGOING" | "ONE_TIME_SNAPSHOT",
  appId: string,
  client: AdminClient
): Promise<void> {
  const res = await ascPost<{ data: { id: string } }>(
    "/v1/analyticsReportRequests",
    buildReportRequestBody(accessType, appId),
  );
  await checkedDatabaseResult(
    "report-request bootstrap write",
    client.from("asc_report_requests").insert({
      asc_request_id: res.data.id,
      app_id: appId,
      access_type: accessType,
    })
  );
}

// ─── Sync ────────────────────────────────────────────────────────────────────

interface ListResponse<A> {
  data: { id: string; attributes: A }[];
  links?: { next?: string };
}

const APP_STORE_WORKLOAD_KEY = "app-store-sync";
const MAX_REQUESTS_PER_RUN = 1;
const MAX_INSTANCES_PER_RUN = 2;
const MAX_SEGMENTS_PER_RUN = 1;

interface AppStoreSyncCursor {
  requestAfterId?: string;
  requestId?: string;
  categoryIndex?: number;
  reportPage?: string;
  reportId?: string;
  reportNext?: string;
  instancePage?: string;
  instanceOffset?: number;
  segmentPage?: string;
}

function parseSyncCursor(raw: string | null): AppStoreSyncCursor {
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("cursor must be an object");
    }
    return parsed as AppStoreSyncCursor;
  } catch (cause) {
    throw new CronDatabaseOperationError(
      "App Store workload cursor is invalid",
      { cause }
    );
  }
}

function serializeSyncCursor(cursor: AppStoreSyncCursor): string | null {
  if (Object.keys(cursor).length === 0) return null;
  const encoded = JSON.stringify(cursor);
  if (encoded.length > 512) {
    throw new Error("App Store workload cursor exceeds 512 bytes");
  }
  return encoded;
}

function nextCategoryOrRequest(
  requestId: string,
  categoryIndex: number
): AppStoreSyncCursor {
  if (categoryIndex === 0) {
    return { requestId, categoryIndex: 1 };
  }
  return { requestAfterId: requestId, categoryIndex: 0 };
}

function nextReportOrCategory(
  requestId: string,
  categoryIndex: number,
  reportNext?: string
): AppStoreSyncCursor {
  if (reportNext) {
    return { requestId, categoryIndex, reportPage: reportNext };
  }
  return nextCategoryOrRequest(requestId, categoryIndex);
}

function nextInstanceOrReport({
  requestId,
  categoryIndex,
  reportId,
  reportNext,
  instancePage,
  instanceNext,
  nextOffset,
  pageLength,
}: {
  requestId: string;
  categoryIndex: number;
  reportId: string;
  reportNext?: string;
  instancePage: string;
  instanceNext?: string;
  nextOffset: number;
  pageLength: number;
}): AppStoreSyncCursor {
  if (nextOffset < pageLength) {
    return {
      requestId,
      categoryIndex,
      reportId,
      reportNext,
      instancePage,
      instanceOffset: nextOffset,
    };
  }
  if (instanceNext) {
    return {
      requestId,
      categoryIndex,
      reportId,
      reportNext,
      instancePage: instanceNext,
      instanceOffset: 0,
    };
  }
  return nextReportOrCategory(requestId, categoryIndex, reportNext);
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
export async function syncOnce(
  client: AdminClient,
  lease: CronWorkloadLease
): Promise<SyncResult> {
  const rawCursor = await readCronWorkloadCursor(
    client,
    APP_STORE_WORKLOAD_KEY,
    lease
  );
  const cursor = parseSyncCursor(rawCursor);
  let segmentsProcessed = 0;
  let rowsIngested = 0;
  let lastDate: string | null = null;

  let requestQuery = client
    .from("asc_report_requests")
    .select("id, asc_request_id")
    .is("stopped_at", null)
    .order("id", { ascending: true });
  if (cursor.requestId) {
    requestQuery = requestQuery.eq("id", cursor.requestId);
  } else if (cursor.requestAfterId) {
    requestQuery = requestQuery.gt("id", cursor.requestAfterId);
  }
  const requestRows = await checkedDatabaseResult<
    { id: string; asc_request_id: string }[] | null
  >(
    "active report-request read",
    requestQuery.limit(MAX_REQUESTS_PER_RUN)
  );
  const req = (requestRows ?? []).slice(0, MAX_REQUESTS_PER_RUN)[0];
  if (!req) {
    await advanceCronWorkloadCursor(
      client,
      APP_STORE_WORKLOAD_KEY,
      lease,
      rawCursor,
      null
    );
    return { segmentsProcessed, rowsIngested, lastDate };
  }

  const categories = [
    [
      CATEGORY_ENGAGEMENT,
      "discovery_engagement",
      ENGAGEMENT_ALIASES,
      "asc_discovery_engagement",
      ENGAGEMENT_CONFLICT,
    ],
    [
      CATEGORY_COMMERCE,
      "downloads",
      DOWNLOAD_ALIASES,
      "asc_downloads",
      DOWNLOAD_CONFLICT,
    ],
  ] as const;
  const categoryIndex = cursor.requestId === req.id
    ? Math.min(Math.max(cursor.categoryIndex ?? 0, 0), 1)
    : 0;
  const [category, kind, aliases, table, conflict] =
    categories[categoryIndex];

  const initialReportPath =
    `/v1/analyticsReportRequests/${req.asc_request_id}` +
    `/reports?filter[category]=${category}&limit=1`;
  let reportId = cursor.requestId === req.id ? cursor.reportId : undefined;
  let reportNext =
    cursor.requestId === req.id ? cursor.reportNext : undefined;
  let reportName: string | undefined;
  const reportPagePath =
    cursor.requestId === req.id && cursor.reportPage
      ? cursor.reportPage
      : initialReportPath;

  if (!reportId) {
    const reportPage = await ascGet<
      ListResponse<{ category: string; name?: string }>
    >(reportPagePath);
    const report = reportPage.data.slice(0, 1)[0];
    if (!report) {
      const nextCursor = nextReportOrCategory(
        req.id,
        categoryIndex,
        reportPage.links?.next
      );
      await advanceCronWorkloadCursor(
        client,
        APP_STORE_WORKLOAD_KEY,
        lease,
        rawCursor,
        serializeSyncCursor(nextCursor)
      );
      return { segmentsProcessed, rowsIngested, lastDate };
    }
    reportId = report.id;
    reportName = report.attributes.name;
    reportNext = reportPage.links?.next;
  }

  const reportPayload: Record<string, unknown> = {
    request_id: req.id,
    asc_report_id: reportId,
    category,
  };
  if (reportName !== undefined) {
    reportPayload.report_name = reportName;
  }
  const reportRow = requireDatabaseRow(
    "report upsert",
    await checkedDatabaseResult<{ id: string } | null>(
      "report upsert",
      client
        .from("asc_reports")
        .upsert(reportPayload, { onConflict: "asc_report_id" })
        .select("id")
        .single()
    )
  );

  const initialInstancePath =
    `/v1/analyticsReports/${reportId}` +
    `/instances?filter[granularity]=DAILY&limit=${MAX_INSTANCES_PER_RUN}`;
  const instancePagePath =
    cursor.requestId === req.id &&
    cursor.reportId === reportId &&
    cursor.instancePage
      ? cursor.instancePage
      : initialInstancePath;
  const instanceOffset =
    cursor.requestId === req.id &&
    cursor.reportId === reportId &&
    cursor.instancePage === instancePagePath
      ? Math.max(cursor.instanceOffset ?? 0, 0)
      : 0;
  const instancePage = await ascGet<
    ListResponse<{ granularity: string; processingDate: string }>
  >(instancePagePath);
  const pageInstances = instancePage.data.slice(
    0,
    MAX_INSTANCES_PER_RUN
  );
  const instances = pageInstances
    .slice(instanceOffset)
    .slice(0, MAX_INSTANCES_PER_RUN);
  let inspectedInstances = 0;

  for (let localIndex = 0; localIndex < instances.length; localIndex += 1) {
    if (inspectedInstances >= MAX_INSTANCES_PER_RUN) break;
    const inst = instances[localIndex];
    const absoluteIndex = instanceOffset + localIndex;
    inspectedInstances += 1;

    const instRow = requireDatabaseRow(
      "report-instance upsert",
      await checkedDatabaseResult<{ id: string } | null>(
        "report-instance upsert",
        client
          .from("asc_report_instances")
          .upsert(
            {
              report_id: reportRow.id,
              asc_instance_id: inst.id,
              granularity: inst.attributes.granularity ?? "DAILY",
              processing_date: inst.attributes.processingDate,
            },
            { onConflict: "asc_instance_id" }
          )
          .select("id")
          .single()
      )
    );

    const initialSegmentPath =
      `/v1/analyticsReportInstances/${inst.id}` +
      `/segments?limit=${MAX_SEGMENTS_PER_RUN}`;
    const segmentPagePath =
      cursor.requestId === req.id &&
      cursor.reportId === reportId &&
      cursor.instancePage === instancePagePath &&
      cursor.instanceOffset === absoluteIndex &&
      cursor.segmentPage
        ? cursor.segmentPage
        : initialSegmentPath;
    const segmentPage = await ascGet<
      ListResponse<{ checksum: string; sizeInBytes?: number; url: string }>
    >(segmentPagePath);
    const segment = segmentPage.data.slice(0, MAX_SEGMENTS_PER_RUN)[0];
    if (!segment) continue;

    const segExisting = await checkedDatabaseResult<
      { id: string; state: string } | null
    >(
      "report-segment state read",
      client
        .from("asc_report_segments")
        .select("id, state")
        .eq("instance_id", instRow.id)
        .eq("checksum", segment.attributes.checksum)
        .maybeSingle()
    );
    if (segExisting?.state === "processed") {
      if (segmentPage.links?.next) {
        const nextCursor: AppStoreSyncCursor = {
          requestId: req.id,
          categoryIndex,
          reportId,
          reportNext,
          instancePage: instancePagePath,
          instanceOffset: absoluteIndex,
          segmentPage: segmentPage.links.next,
        };
        await advanceCronWorkloadCursor(
          client,
          APP_STORE_WORKLOAD_KEY,
          lease,
          rawCursor,
          serializeSyncCursor(nextCursor)
        );
        return { segmentsProcessed, rowsIngested, lastDate };
      }
      continue;
    }

    const segRow = requireDatabaseRow(
      "report-segment upsert",
      await checkedDatabaseResult<{ id: string } | null>(
        "report-segment upsert",
        client
          .from("asc_report_segments")
          .upsert(
            {
              instance_id: instRow.id,
              checksum: segment.attributes.checksum,
              size_bytes: segment.attributes.sizeInBytes ?? null,
              url: segment.attributes.url,
              state: "discovered",
            },
            { onConflict: "instance_id,checksum" }
          )
          .select("id")
          .single()
      )
    );

    const text = await downloadSegment(segment.attributes.url);
    const parsed = parseTsv(text, aliases);
    if (parsed.length > 0) {
      await checkedDatabaseResult(
        "raw report-row insert",
        client.from("asc_raw_rows").insert(
          parsed.map((row) => ({
            segment_id: segRow.id,
            report_kind: kind,
            reporting_date:
              (row.reporting_date as string) ??
              inst.attributes.processingDate,
            raw: row.raw,
          }))
        )
      );
      const facts = parsed
        .map((row) =>
          kind === "discovery_engagement"
            ? toEngagementFact(row, segRow.id)
            : toDownloadFact(row, segRow.id)
        )
        .filter((fact) => fact.reporting_date);
      if (facts.length > 0) {
        await checkedDatabaseResult(
          `${table} fact upsert`,
          client.from(table).upsert(facts, { onConflict: conflict })
        );
      }
      rowsIngested += facts.length;
    }

    await checkedDatabaseResult(
      "report-segment completion write",
      client
        .from("asc_report_segments")
        .update({
          state: "processed",
          rows_ingested: parsed.length,
          processed_at: new Date().toISOString(),
        })
        .eq("id", segRow.id)
    );
    await checkedDatabaseResult(
      "report-instance completion write",
      client
        .from("asc_report_instances")
        .update({
          state: "processed",
          processed_at: new Date().toISOString(),
        })
        .eq("id", instRow.id)
    );

    segmentsProcessed = 1;
    lastDate = inst.attributes.processingDate;
    const nextCursor = segmentPage.links?.next
      ? {
          requestId: req.id,
          categoryIndex,
          reportId,
          reportNext,
          instancePage: instancePagePath,
          instanceOffset: absoluteIndex,
          segmentPage: segmentPage.links.next,
        }
      : nextInstanceOrReport({
          requestId: req.id,
          categoryIndex,
          reportId,
          reportNext,
          instancePage: instancePagePath,
          instanceNext: instancePage.links?.next,
          nextOffset: absoluteIndex + 1,
          pageLength: pageInstances.length,
        });
    await advanceCronWorkloadCursor(
      client,
      APP_STORE_WORKLOAD_KEY,
      lease,
      rawCursor,
      serializeSyncCursor(nextCursor)
    );
    return { segmentsProcessed, rowsIngested, lastDate };
  }

  const nextCursor = nextInstanceOrReport({
    requestId: req.id,
    categoryIndex,
    reportId,
    reportNext,
    instancePage: instancePagePath,
    instanceNext: instancePage.links?.next,
    nextOffset: instanceOffset + instances.length,
    pageLength: pageInstances.length,
  });
  await advanceCronWorkloadCursor(
    client,
    APP_STORE_WORKLOAD_KEY,
    lease,
    rawCursor,
    serializeSyncCursor(nextCursor)
  );

  return { segmentsProcessed, rowsIngested, lastDate };
}
