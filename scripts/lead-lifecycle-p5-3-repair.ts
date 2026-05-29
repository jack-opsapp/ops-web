/*
 * Lead Lifecycle P5-3 repair script.
 *
 * Repairs only:
 * - lifecycle notification action_url/action_label values
 * - lifecycle notification resolved state when stale state already cleared
 * - template_follow_up draft subjects that are blank
 *
 * Emails sent: no.
 * Provider drafts created: no.
 * Guarded destructive apply: no.
 * Opportunity business state changed: no.
 * P6 started: no.
 *
 * Usage:
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web npx tsx scripts/lead-lifecycle-p5-3-repair.ts --target notification-links
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web npx tsx scripts/lead-lifecycle-p5-3-repair.ts --target notification-links --apply
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web npx tsx scripts/lead-lifecycle-p5-3-repair.ts --target draft-subjects
 *   OPS_WEB_ENV_DIR=/Users/jacksonsweet/Projects/OPS/ops-web npx tsx scripts/lead-lifecycle-p5-3-repair.ts --target draft-subjects --apply
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT } from "../src/lib/email/opportunity-lifecycle-evaluator";

type Target = "notification-links" | "draft-subjects";

const ENV_DIR = process.env.OPS_WEB_ENV_DIR || process.cwd();
loadEnvConfig(ENV_DIR);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const NOTIFICATION_DRY_RUN_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p5-3-notification-link-repair-dry-run-2026-05-29.md";
const NOTIFICATION_APPLY_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p5-3-notification-link-repair-apply-2026-05-29.md";
const DRAFT_SUBJECT_DRY_RUN_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p5-3-draft-subject-repair-dry-run-2026-05-29.md";
const DRAFT_SUBJECT_APPLY_OUTPUT =
  "/Users/jacksonsweet/Projects/OPS/docs/data-cleanup/lead-lifecycle-p5-3-draft-subject-repair-apply-2026-05-29.md";

const targetArgIdx = process.argv.indexOf("--target");
const TARGET =
  targetArgIdx >= 0 ? (process.argv[targetArgIdx + 1] as Target) : null;
const APPLY = process.argv.includes("--apply");
const outputArgIdx = process.argv.indexOf("--output");
const OUTPUT_PATH =
  outputArgIdx >= 0
    ? process.argv[outputArgIdx + 1]
    : defaultOutputPath(TARGET, APPLY);

if (TARGET !== "notification-links" && TARGET !== "draft-subjects") {
  console.error("--target must be notification-links or draft-subjects");
  process.exit(1);
}

if (!OUTPUT_PATH) {
  console.error("--output must not be blank");
  process.exit(1);
}

interface NotificationRow {
  id: string;
  company_id: string;
  dedupe_key: string;
  action_url: string | null;
  action_label: string | null;
  is_read: boolean;
  resolved_at: string | null;
  created_at: string;
}

interface EmailThreadRow {
  id: string;
  company_id: string;
  connection_id: string | null;
  provider_thread_id: string;
  opportunity_id: string | null;
}

interface LifecycleStateRow {
  opportunity_id: string;
  stale_status: string | null;
}

interface NotificationPlan {
  id: string;
  companyId: string;
  opportunityId: string;
  currentActionUrl: string | null;
  nextActionUrl: string;
  currentActionLabel: string | null;
  nextActionLabel: string;
  routeReason: string;
  resolve: boolean;
  currentIsRead: boolean;
  currentResolvedAt: string | null;
}

interface DraftSubjectRow {
  id: string;
  company_id: string;
  opportunity_id: string;
  subject: string;
  updated_at: string;
}

function defaultOutputPath(target: Target | null, apply: boolean): string {
  if (target === "notification-links") {
    return apply ? NOTIFICATION_APPLY_OUTPUT : NOTIFICATION_DRY_RUN_OUTPUT;
  }
  if (target === "draft-subjects") {
    return apply ? DRAFT_SUBJECT_APPLY_OUTPUT : DRAFT_SUBJECT_DRY_RUN_OUTPUT;
  }
  return "";
}

function md(value: unknown): string {
  const text = value == null || value === "" ? "-" : String(value);
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function decodeInboxUrl(value: string | null): string | null {
  if (!value?.startsWith("/inbox/")) return null;
  const raw = value.slice("/inbox/".length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function opportunityIdFromDedupeKey(value: string): string | null {
  const parts = value.split(":");
  return parts.length >= 3 ? parts[2] : null;
}

function pipelineUrl(opportunityId: string): string {
  return `/pipeline?opportunityId=${encodeURIComponent(opportunityId)}`;
}

function hardStopProof(): string {
  return [
    "## Hard-Stop Proof",
    "",
    "- Emails sent: no.",
    "- Provider drafts created: no.",
    "- Archive/lost/reactivation execution: no.",
    "- Guarded destructive apply: no.",
    "- Opportunity business state changed: no.",
    "- P6 started: no.",
  ].join("\n");
}

async function fetchNotificationPlan(): Promise<NotificationPlan[]> {
  const { data: notifications, error } = await sb
    .from("notifications")
    .select(
      "id, company_id, dedupe_key, action_url, action_label, is_read, resolved_at, created_at"
    )
    .eq("type", "leads_waiting")
    .like("dedupe_key", "lead_lifecycle:%")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (notifications ?? []) as NotificationRow[];
  const providerThreadIds = Array.from(
    new Set(rows.map((row) => decodeInboxUrl(row.action_url)).filter(Boolean))
  ) as string[];
  const companyIds = Array.from(new Set(rows.map((row) => row.company_id)));
  const opportunityIds = Array.from(
    new Set(
      rows
        .map((row) => opportunityIdFromDedupeKey(row.dedupe_key))
        .filter(Boolean)
    )
  ) as string[];

  const threadRows: EmailThreadRow[] = [];
  const internalThreadIds = providerThreadIds.filter(isUuid);
  if (internalThreadIds.length > 0) {
    const { data, error: threadErr } = await sb
      .from("email_threads")
      .select("id, company_id, connection_id, provider_thread_id, opportunity_id")
      .in("company_id", companyIds)
      .in("id", internalThreadIds);
    if (threadErr) throw new Error(threadErr.message);
    threadRows.push(...((data ?? []) as EmailThreadRow[]));
  }
  for (const providerThreadId of providerThreadIds) {
    if (providerThreadId.includes(":")) continue;
    const { data, error: threadErr } = await sb
      .from("email_threads")
      .select("id, company_id, connection_id, provider_thread_id, opportunity_id")
      .in("company_id", companyIds)
      .eq("provider_thread_id", providerThreadId);
    if (threadErr) throw new Error(threadErr.message);
    threadRows.push(...((data ?? []) as EmailThreadRow[]));
  }

  const stateRows: LifecycleStateRow[] = [];
  if (opportunityIds.length > 0) {
    const { data, error: stateErr } = await sb
      .from("opportunity_lifecycle_state")
      .select("opportunity_id, stale_status")
      .in("opportunity_id", opportunityIds);
    if (stateErr) throw new Error(stateErr.message);
    stateRows.push(...((data ?? []) as LifecycleStateRow[]));
  }
  const stateByOpportunity = new Map(
    stateRows.map((row) => [row.opportunity_id, row])
  );

  return rows.map((row) => {
    const opportunityId = opportunityIdFromDedupeKey(row.dedupe_key) ?? "";
    const providerThreadId = decodeInboxUrl(row.action_url);
    const thread = providerThreadId
      ? threadRows.find(
          (candidate) =>
            candidate.company_id === row.company_id &&
            candidate.id === providerThreadId
        ) ??
        (!providerThreadId.includes(":")
          ? threadRows.find(
              (candidate) =>
                candidate.company_id === row.company_id &&
                candidate.provider_thread_id === providerThreadId &&
                (!candidate.opportunity_id ||
                  !opportunityId ||
                  candidate.opportunity_id === opportunityId)
            ) ?? null
          : null)
      : null;
    const nextActionUrl = thread?.id
      ? `/inbox/${encodeURIComponent(thread.id)}`
      : pipelineUrl(opportunityId);
    const nextActionLabel = thread?.id ? "Open thread" : "Open opportunity";
    const state = stateByOpportunity.get(opportunityId);
    const resolve =
      !row.is_read &&
      row.resolved_at === null &&
      state !== undefined &&
      state.stale_status !== "operator_follow_up_miss";

    return {
      id: row.id,
      companyId: row.company_id,
      opportunityId,
      currentActionUrl: row.action_url,
      nextActionUrl,
      currentActionLabel: row.action_label,
      nextActionLabel,
      routeReason: thread?.id
        ? "provider_thread_id_resolved_to_internal_email_thread_id"
        : "no_internal_thread_fallback_to_pipeline",
      resolve,
      currentIsRead: row.is_read,
      currentResolvedAt: row.resolved_at,
    };
  });
}

async function applyNotificationPlan(plan: NotificationPlan[]) {
  const now = new Date().toISOString();
  for (const row of plan) {
    const payload: Record<string, unknown> = {};
    if (
      row.currentActionUrl !== row.nextActionUrl ||
      row.currentActionLabel !== row.nextActionLabel
    ) {
      payload.action_url = row.nextActionUrl;
      payload.action_label = row.nextActionLabel;
    }
    if (row.resolve) {
      payload.is_read = true;
      payload.resolved_at = now;
    }
    if (Object.keys(payload).length === 0) continue;

    const { error } = await sb.from("notifications").update(payload).eq("id", row.id);
    if (error) throw new Error(error.message);
  }
}

function renderNotificationArtifact(plan: NotificationPlan[], apply: boolean): string {
  const urlChanges = plan.filter(
    (row) =>
      row.currentActionUrl !== row.nextActionUrl ||
      row.currentActionLabel !== row.nextActionLabel
  );
  const resolves = plan.filter((row) => row.resolve);

  return [
    `# Lead Lifecycle P5-3 Notification Link Repair ${apply ? "Apply" : "Dry Run"}`,
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Mode: ${apply ? "apply" : "dry-run"}`,
    "",
    "## Summary",
    "",
    `- Lifecycle notifications scanned: ${plan.length}`,
    `- Action URL/label changes: ${urlChanges.length}`,
    `- Notifications resolved because stale state already cleared: ${resolves.length}`,
    "",
    hardStopProof(),
    "",
    "## Planned / Applied Rows",
    "",
    "| notification_id | opportunity_id | current_action_url | next_action_url | current_label | next_label | route_reason | resolve |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...plan.map(
      (row) =>
        `| ${md(row.id)} | ${md(row.opportunityId)} | ${md(row.currentActionUrl)} | ${md(row.nextActionUrl)} | ${md(row.currentActionLabel)} | ${md(row.nextActionLabel)} | ${md(row.routeReason)} | ${row.resolve ? "yes" : "no"} |`
    ),
    "",
  ].join("\n");
}

async function fetchDraftSubjectRows(): Promise<DraftSubjectRow[]> {
  const { data, error } = await sb
    .from("opportunity_follow_up_drafts")
    .select("id, company_id, opportunity_id, subject, updated_at")
    .eq("origin", "template_follow_up")
    .eq("status", "drafted")
    .or("subject.is.null,subject.eq.")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as DraftSubjectRow[];
}

async function applyDraftSubjectRows(rows: DraftSubjectRow[]) {
  const now = new Date().toISOString();
  for (const row of rows) {
    const { error } = await sb.from("opportunity_follow_up_drafts").update({
      subject: DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT,
      updated_at: now,
    }).eq("id", row.id);
    if (error) throw new Error(error.message);
  }
}

function renderDraftSubjectArtifact(rows: DraftSubjectRow[], apply: boolean): string {
  return [
    `# Lead Lifecycle P5-3 Draft Subject Repair ${apply ? "Apply" : "Dry Run"}`,
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Mode: ${apply ? "apply" : "dry-run"}`,
    "",
    "## Summary",
    "",
    `- Drafted template_follow_up rows scanned for blank subjects: ${rows.length}`,
    `- Subject value: ${DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT}`,
    "",
    hardStopProof(),
    "",
    "## Planned / Applied Rows",
    "",
    "| draft_id | company_id | opportunity_id | current_subject | next_subject |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${md(row.id)} | ${md(row.company_id)} | ${md(row.opportunity_id)} | ${md(row.subject)} | ${md(DEFAULT_FOLLOW_UP_TEMPLATE_SUBJECT)} |`
    ),
    "",
  ].join("\n");
}

async function writeArtifact(markdown: string) {
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, markdown);
}

async function main() {
  if (TARGET === "notification-links") {
    const plan = await fetchNotificationPlan();
    if (APPLY) await applyNotificationPlan(plan);
    await writeArtifact(renderNotificationArtifact(plan, APPLY));
  } else {
    const rows = await fetchDraftSubjectRows();
    if (APPLY) await applyDraftSubjectRows(rows);
    await writeArtifact(renderDraftSubjectArtifact(rows, APPLY));
  }

  console.log(`Artifact write: ${OUTPUT_PATH}`);
  console.log(`Mode: ${APPLY ? "apply" : "dry-run"}`);
  console.log(`Target: ${TARGET}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
