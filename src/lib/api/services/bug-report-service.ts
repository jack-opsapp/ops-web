/**
 * OPS Web - Bug Report Service (Supabase)
 *
 * CRUD operations for bug reports stored in Supabase `bug_reports` table.
 */

import { requireSupabase, parseDate } from "@/lib/supabase/helpers";

// ─── Types ───────────────────────────────────────────────────────────────────

export type BugReportCategory = "bug" | "ui_issue" | "crash" | "feature_request" | "other";
export type BugReportPlatform = "ios" | "web";
export type BugReportPriority = "urgent" | "high" | "medium" | "low" | "none";
export type BugReportStatus = "new" | "triaged" | "in_progress" | "resolved" | "closed" | "duplicate";

export interface BugReport {
  id: string;
  companyId: string;
  reporterId: string;

  // User input
  description: string;
  category: BugReportCategory;

  // Auto-captured context
  platform: BugReportPlatform;
  appVersion: string | null;
  buildNumber: string | null;
  osName: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  browser: string | null;
  browserVersion: string | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  screenName: string | null;
  url: string | null;

  // Device state
  networkType: string | null;
  batteryLevel: number | null;
  freeDiskMb: number | null;
  freeRamMb: number | null;

  // Rich context
  consoleLogs: unknown[];
  breadcrumbs: unknown[];
  networkLog: unknown[];
  stateSnapshot: Record<string, unknown>;
  customMetadata: Record<string, unknown>;

  // Attachments
  screenshotUrl: string | null;
  additionalAttachments: string[];

  // Reporter info
  reporterName: string | null;
  reporterEmail: string | null;

  // Triage
  priority: BugReportPriority;
  status: BugReportStatus;
  assignedTo: string | null;
  resolvedAt: Date | null;
  resolutionNotes: string | null;

  createdAt: Date | null;
  updatedAt: Date | null;
}

// ─── Mapping ─────────────────────────────────────────────────────────────────

function mapFromDb(row: Record<string, unknown>): BugReport {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    reporterId: row.reporter_id as string,

    description: row.description as string,
    category: (row.category as BugReportCategory) ?? "bug",

    platform: row.platform as BugReportPlatform,
    appVersion: (row.app_version as string) ?? null,
    buildNumber: (row.build_number as string) ?? null,
    osName: (row.os_name as string) ?? null,
    osVersion: (row.os_version as string) ?? null,
    deviceModel: (row.device_model as string) ?? null,
    browser: (row.browser as string) ?? null,
    browserVersion: (row.browser_version as string) ?? null,
    viewportWidth: (row.viewport_width as number) ?? null,
    viewportHeight: (row.viewport_height as number) ?? null,
    screenName: (row.screen_name as string) ?? null,
    url: (row.url as string) ?? null,

    networkType: (row.network_type as string) ?? null,
    batteryLevel: (row.battery_level as number) ?? null,
    freeDiskMb: (row.free_disk_mb as number) ?? null,
    freeRamMb: (row.free_ram_mb as number) ?? null,

    consoleLogs: (row.console_logs as unknown[]) ?? [],
    breadcrumbs: (row.breadcrumbs as unknown[]) ?? [],
    networkLog: (row.network_log as unknown[]) ?? [],
    stateSnapshot: (row.state_snapshot as Record<string, unknown>) ?? {},
    customMetadata: (row.custom_metadata as Record<string, unknown>) ?? {},

    screenshotUrl: (row.screenshot_url as string) ?? null,
    additionalAttachments: (row.additional_attachments as string[]) ?? [],

    reporterName: (row.reporter_name as string) ?? null,
    reporterEmail: (row.reporter_email as string) ?? null,

    priority: (row.priority as BugReportPriority) ?? "none",
    status: (row.status as BugReportStatus) ?? "new",
    assignedTo: (row.assigned_to as string) ?? null,
    resolvedAt: parseDate(row.resolved_at),
    resolutionNotes: (row.resolution_notes as string) ?? null,

    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
  };
}

function mapToDb(data: Partial<BugReport>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.reporterId !== undefined) row.reporter_id = data.reporterId;
  if (data.description !== undefined) row.description = data.description;
  if (data.category !== undefined) row.category = data.category;
  if (data.platform !== undefined) row.platform = data.platform;
  if (data.appVersion !== undefined) row.app_version = data.appVersion;
  if (data.buildNumber !== undefined) row.build_number = data.buildNumber;
  if (data.osName !== undefined) row.os_name = data.osName;
  if (data.osVersion !== undefined) row.os_version = data.osVersion;
  if (data.deviceModel !== undefined) row.device_model = data.deviceModel;
  if (data.browser !== undefined) row.browser = data.browser;
  if (data.browserVersion !== undefined) row.browser_version = data.browserVersion;
  if (data.viewportWidth !== undefined) row.viewport_width = data.viewportWidth;
  if (data.viewportHeight !== undefined) row.viewport_height = data.viewportHeight;
  if (data.screenName !== undefined) row.screen_name = data.screenName;
  if (data.url !== undefined) row.url = data.url;
  if (data.networkType !== undefined) row.network_type = data.networkType;
  if (data.batteryLevel !== undefined) row.battery_level = data.batteryLevel;
  if (data.freeDiskMb !== undefined) row.free_disk_mb = data.freeDiskMb;
  if (data.freeRamMb !== undefined) row.free_ram_mb = data.freeRamMb;
  if (data.consoleLogs !== undefined) row.console_logs = data.consoleLogs;
  if (data.breadcrumbs !== undefined) row.breadcrumbs = data.breadcrumbs;
  if (data.networkLog !== undefined) row.network_log = data.networkLog;
  if (data.stateSnapshot !== undefined) row.state_snapshot = data.stateSnapshot;
  if (data.customMetadata !== undefined) row.custom_metadata = data.customMetadata;
  if (data.screenshotUrl !== undefined) row.screenshot_url = data.screenshotUrl;
  if (data.additionalAttachments !== undefined) row.additional_attachments = data.additionalAttachments;
  if (data.reporterName !== undefined) row.reporter_name = data.reporterName;
  if (data.reporterEmail !== undefined) row.reporter_email = data.reporterEmail;
  if (data.priority !== undefined) row.priority = data.priority;
  if (data.status !== undefined) row.status = data.status;
  if (data.assignedTo !== undefined) row.assigned_to = data.assignedTo;
  if (data.resolvedAt !== undefined) row.resolved_at = data.resolvedAt?.toISOString() ?? null;
  if (data.resolutionNotes !== undefined) row.resolution_notes = data.resolutionNotes;
  return row;
}

// ─── Query Options ───────────────────────────────────────────────────────────

export interface FetchBugReportsOptions {
  status?: BugReportStatus;
  priority?: BugReportPriority;
  platform?: BugReportPlatform;
  category?: BugReportCategory;
  limit?: number;
  cursor?: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const BugReportService = {
  async fetchReports(
    companyId: string,
    options: FetchBugReportsOptions = {}
  ): Promise<{ reports: BugReport[]; remaining: number; count: number }> {
    const supabase = requireSupabase();
    const limit = Math.min(options.limit ?? 100, 100);
    const offset = options.cursor ?? 0;

    let query = supabase
      .from("bug_reports")
      .select("*", { count: "exact" })
      .eq("company_id", companyId);

    if (options.status) query = query.eq("status", options.status);
    if (options.priority) query = query.eq("priority", options.priority);
    if (options.platform) query = query.eq("platform", options.platform);
    if (options.category) query = query.eq("category", options.category);

    query = query.order("created_at", { ascending: false });
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(`Failed to fetch bug reports: ${error.message}`);

    const total = count ?? 0;
    const reports = (data ?? []).map(mapFromDb);
    const remaining = Math.max(0, total - offset - reports.length);

    return { reports, remaining, count: total };
  },

  async fetchAllReports(
    companyId: string,
    options: Omit<FetchBugReportsOptions, "limit" | "cursor"> = {}
  ): Promise<BugReport[]> {
    const all: BugReport[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await BugReportService.fetchReports(companyId, {
        ...options,
        limit: 100,
        cursor: offset,
      });
      all.push(...result.reports);
      hasMore = result.remaining > 0;
      offset += result.reports.length;
    }

    return all;
  },

  async fetchReport(id: string): Promise<BugReport> {
    const supabase = requireSupabase();
    const { data, error } = await supabase
      .from("bug_reports")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Failed to fetch bug report: ${error.message}`);
    return mapFromDb(data);
  },

  async createReport(
    data: Partial<BugReport> & { description: string; companyId: string; reporterId: string; platform: BugReportPlatform }
  ): Promise<string> {
    const supabase = requireSupabase();
    const row = mapToDb(data);

    const { data: created, error } = await supabase
      .from("bug_reports")
      .insert(row)
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create bug report: ${error.message}`);
    return created.id as string;
  },

  async updateReport(id: string, data: Partial<BugReport>): Promise<void> {
    const supabase = requireSupabase();
    const row = mapToDb(data);
    row.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from("bug_reports")
      .update(row)
      .eq("id", id);

    if (error) throw new Error(`Failed to update bug report: ${error.message}`);
  },

  async updateStatus(id: string, status: BugReportStatus, resolutionNotes?: string): Promise<void> {
    const supabase = requireSupabase();
    const update: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (status === "resolved" || status === "closed") {
      update.resolved_at = new Date().toISOString();
    }
    if (resolutionNotes !== undefined) {
      update.resolution_notes = resolutionNotes;
    }

    const { error } = await supabase
      .from("bug_reports")
      .update(update)
      .eq("id", id);

    if (error) throw new Error(`Failed to update bug report status: ${error.message}`);
  },

  async updatePriority(id: string, priority: BugReportPriority): Promise<void> {
    const supabase = requireSupabase();
    const { error } = await supabase
      .from("bug_reports")
      .update({ priority, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(`Failed to update bug report priority: ${error.message}`);
  },

  async uploadScreenshot(
    companyId: string,
    reportId: string,
    file: File | Blob
  ): Promise<string> {
    const supabase = requireSupabase();
    const path = `${companyId}/${reportId}/screenshot.jpg`;

    const { error } = await supabase.storage
      .from("bug-reports")
      .upload(path, file, { contentType: "image/jpeg", upsert: true });

    if (error) throw new Error(`Failed to upload screenshot: ${error.message}`);

    const { data: urlData } = supabase.storage
      .from("bug-reports")
      .getPublicUrl(path);

    return urlData.publicUrl;
  },

  async getScreenshotUrl(path: string): Promise<string> {
    const supabase = requireSupabase();
    const { data } = await supabase.storage
      .from("bug-reports")
      .createSignedUrl(path, 3600);

    return data?.signedUrl ?? "";
  },
};

export default BugReportService;
