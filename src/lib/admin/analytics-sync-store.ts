import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export type AnalyticsSource =
  | "search_console"
  | "ga4_marketing"
  | "ga4_web_app"
  | "ga4_ios_qa"
  | "app_store"
  | "analytics_health";

export interface LatestSyncState {
  cursor: string | null;
  metadata: Record<string, unknown>;
}

export interface StoredChannelMapRule {
  raw_channel: string | null;
  raw_source: string | null;
  raw_medium: string | null;
  canonical_channel: string;
  priority: number;
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
  }
  return String(error);
}

export class AnalyticsSyncStore {
  constructor(private readonly client: SupabaseClient = getAdminSupabase()) {}

  async latest(source: AnalyticsSource): Promise<LatestSyncState | null> {
    const { data, error } = await this.client
      .from("analytics_sync_runs")
      .select("cursor, metadata")
      .eq("source", source)
      .in("status", ["complete", "partial"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Analytics sync state read failed: ${error.message}`);
    if (!data) return null;
    return {
      cursor: typeof data.cursor === "string" ? data.cursor : null,
      metadata:
        data.metadata && typeof data.metadata === "object"
          ? (data.metadata as Record<string, unknown>)
          : {},
    };
  }

  async begin(
    source: AnalyticsSource,
    metadata: Record<string, unknown>
  ): Promise<string> {
    const { data, error } = await this.client
      .from("analytics_sync_runs")
      .insert({ source, status: "running", metadata })
      .select("id")
      .single();
    if (error || !data?.id) {
      throw new Error(
        `Analytics sync start failed: ${error?.message ?? "no run id"}`
      );
    }
    return String(data.id);
  }

  async channelMap(sourceSystem: string): Promise<StoredChannelMapRule[]> {
    const { data, error } = await this.client
      .from("channel_map")
      .select("raw_channel, raw_source, raw_medium, canonical_channel, priority")
      .eq("source_system", sourceSystem)
      .eq("active", true)
      .order("priority", { ascending: true });
    if (error) throw new Error(`Analytics channel map read failed: ${error.message}`);
    return (data ?? []).map((row) => ({
      raw_channel: typeof row.raw_channel === "string" ? row.raw_channel : null,
      raw_source: typeof row.raw_source === "string" ? row.raw_source : null,
      raw_medium: typeof row.raw_medium === "string" ? row.raw_medium : null,
      canonical_channel: String(row.canonical_channel),
      priority: Number(row.priority),
    }));
  }

  async complete(
    runId: string,
    input: {
      status?: "complete" | "partial";
      sourceMaxDate: string | null;
      rowCount: number;
      cursor: string | null;
      metadata: Record<string, unknown>;
    }
  ): Promise<void> {
    const { error } = await this.client
      .from("analytics_sync_runs")
      .update({
        status: input.status ?? "complete",
        finished_at: new Date().toISOString(),
        source_max_date: input.sourceMaxDate,
        row_count: input.rowCount,
        cursor: input.cursor,
        error_code: null,
        error_message: null,
        metadata: input.metadata,
      })
      .eq("id", runId);
    if (error) throw new Error(`Analytics sync completion failed: ${error.message}`);
  }

  async fail(runId: string, error: unknown): Promise<void> {
    const errorCode =
      error && typeof error === "object" && "status" in error
        ? String((error as { status: unknown }).status)
        : error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "sync_failed";
    const { error: writeError } = await this.client
      .from("analytics_sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_code: errorCode.slice(0, 120),
        error_message: messageFrom(error).slice(0, 800),
      })
      .eq("id", runId);
    if (writeError) {
      throw new Error(`Analytics sync failure write failed: ${writeError.message}`);
    }
  }

  async replaceSearchConsoleDate(input: {
    siteUrl: string;
    reportingDate: string;
    rows: Record<string, unknown>[];
    metrics: Record<string, unknown>[];
  }): Promise<number> {
    const { data, error } = await this.client.rpc(
      "replace_search_console_daily",
      {
        p_site_url: input.siteUrl,
        p_reporting_date: input.reportingDate,
        p_rows: input.rows,
        p_metrics: input.metrics,
      }
    );
    if (error) {
      throw new Error(`Search Console atomic replace failed: ${error.message}`);
    }
    const count = Number(
      data && typeof data === "object" && "row_count" in data
        ? (data as { row_count: unknown }).row_count
        : input.rows.length
    );
    return Number.isFinite(count) ? count : input.rows.length;
  }

  async replaceGA4Date(input: {
    propertyKey: "marketing" | "web_app";
    propertyId: string;
    reportingDate: string;
    rows: Record<string, unknown>[];
    metrics: Record<string, unknown>[];
  }): Promise<number> {
    const { data, error } = await this.client.rpc("replace_ga4_daily_acquisition", {
      p_property_key: input.propertyKey,
      p_property_id: input.propertyId,
      p_reporting_date: input.reportingDate,
      p_rows: input.rows,
      p_metrics: input.metrics,
    });
    if (error) throw new Error(`GA4 atomic replace failed: ${error.message}`);
    const count = Number(
      data && typeof data === "object" && "row_count" in data
        ? (data as { row_count: unknown }).row_count
        : input.rows.length
    );
    return Number.isFinite(count) ? count : input.rows.length;
  }
}
