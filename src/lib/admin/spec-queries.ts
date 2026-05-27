/**
 * SPEC admin data layer.
 *
 * SERVER ONLY. Every query uses `getAdminSupabase()` (service-role); SPEC tables
 * are RLS-locked behind `private.is_spec_operator()`. The route layout enforces
 * the operator gate before any of these helpers run — by the time we get here,
 * we already trust the caller.
 *
 * Conventions:
 *  - `testMode` controls whether `is_test = true` rows are included.
 *  - Cents stay as cents; UI formats with JetBrains Mono tabular-lining.
 *  - Cache hints favor freshness (TODAY 30s, capacity 60s, revenue 5min) over throughput;
 *    the admin user pool is small (Jackson + delegated operators) so we are not at
 *    risk of cache stampedes here.
 *  - Date-based queries normalize to ISO strings to avoid TZ surprises.
 */

import { unstable_cache } from "next/cache";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { GUARANTEE_REFUND_WINDOW_DAYS } from "@/lib/spec/constants";
import {
  KANBAN_COLUMNS,
  type CapacityRow,
  type CycleTimeRow,
  type KanbanCard,
  type KanbanColumn,
  type KanbanSideCounters,
  type PipelineVelocity,
  type RevenuePoint,
  type RevenueSummary,
  type SlowestProject,
  type SpecHoldType,
  type SpecOverviewSnapshot,
  type SpecOwnerApprovalQueueRow,
  type SpecOwnerApprovalStatus,
  type SpecPaymentMilestone,
  type SpecPaymentStatus,
  type SpecProjectStatus,
  type SpecRefundEligibility,
  type SpecRefundPaymentSummary,
  type SpecRefundQueueRow,
  type SpecRefundRequestSource,
  type SpecRefundRequestStatus,
  type SpecTier,
  type TodayItem,
  type TodaySection,
  type VelocityRow,
} from "./spec-types";

const db = () => getAdminSupabase();

// ─── Time helpers ────────────────────────────────────────────────────────────

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function ageLabelFromIso(iso: string | null | undefined): {
  ageLabel: string;
  ageMinutes: number;
} {
  if (!iso) return { ageLabel: "—", ageMinutes: 0 };
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return { ageLabel: "0m", ageMinutes: 0 };
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return { ageLabel: `${minutes}m`, ageMinutes: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { ageLabel: `${hours}h`, ageMinutes: minutes };
  const days = Math.floor(hours / 24);
  if (days < 30) return { ageLabel: `${days}d`, ageMinutes: minutes };
  const months = Math.floor(days / 30);
  return { ageLabel: `${months}mo`, ageMinutes: minutes };
}

function daysBetween(fromIso: string | null | undefined, toMs: number = Date.now()): number {
  if (!fromIso) return 0;
  return Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / DAY));
}

function ofTier(tier: string | null | undefined): SpecTier {
  if (tier === "build" || tier === "enterprise") return tier;
  return "setup";
}

// ─── Test-mode filter ────────────────────────────────────────────────────────

type Filterable = {
  eq: (col: string, val: unknown) => Filterable;
};

/**
 * When `testMode` is false, narrow the query to `is_test = false`. When true,
 * leave the filter off (admin sees both test + live rows; UI badges the test rows).
 */
function applyTestModeFilter<T extends Filterable>(q: T, testMode: boolean): T {
  return testMode ? q : (q.eq("is_test", false) as T);
}

// ─── TODAY queue queries ─────────────────────────────────────────────────────

interface ProjectRowMinimal {
  id: string;
  status: SpecProjectStatus;
  tier: SpecTier;
  customer_name: string | null;
  customer_email: string;
  hold_type: SpecHoldType | null;
  deposit_paid_at: string | null;
  intake_completed_at: string | null;
  discovery_scheduled_at: string | null;
  walkthrough_completed_at: string | null;
  walkthrough_recording_url: string | null;
  last_communication_at: string | null;
  checkout_token_expires_at: string | null;
  on_hold_expires_at: string | null;
  no_show_count: number | null;
  intake_responses: Record<string, unknown> | null;
}

function projectLabel(row: { customer_name: string | null; customer_email: string }): string {
  return row.customer_name?.trim() || row.customer_email;
}

async function loadActiveProjects(testMode: boolean): Promise<ProjectRowMinimal[]> {
  const query = db()
    .from("spec_projects")
    .select(
      "id, status, tier, customer_name, customer_email, hold_type, deposit_paid_at, intake_completed_at, discovery_scheduled_at, walkthrough_completed_at, walkthrough_recording_url, last_communication_at, checkout_token_expires_at, on_hold_expires_at, no_show_count, intake_responses",
    )
    .in("status", [
      "awaiting_owner_approval",
      "awaiting_deposit",
      "deposit_paid",
      "discovery",
      "building",
      "on_hold",
      "support",
      "on_retainer",
    ]);
  const { data, error } = await applyTestModeFilter(query as unknown as Filterable, testMode) as unknown as {
    data: ProjectRowMinimal[] | null;
    error: { message: string } | null;
  };
  if (error) {
    console.error("[loadActiveProjects] failed:", error.message);
    return [];
  }
  return data ?? [];
}

interface PaymentRow {
  id: string;
  spec_project_id: string;
  milestone: "deposit" | "scope_signoff" | "midpoint" | "delivery";
  status: SpecPaymentStatus;
  total_cents: number;
  amount_refunded_cents: number | null;
  due_date: string | null;
  paid_at: string | null;
  invoiced_at: string | null;
  is_test: boolean;
}

async function loadAllPayments(testMode: boolean): Promise<PaymentRow[]> {
  const query = db()
    .from("spec_payments")
    .select(
      "id, spec_project_id, milestone, status, total_cents, amount_refunded_cents, due_date, paid_at, invoiced_at, is_test",
    );
  const { data, error } = await applyTestModeFilter(query as unknown as Filterable, testMode) as unknown as {
    data: PaymentRow[] | null;
    error: { message: string } | null;
  };
  if (error) {
    console.error("[loadAllPayments] failed:", error.message);
    return [];
  }
  return data ?? [];
}

interface AcceptanceEventRow {
  spec_project_id: string;
  event_type: string;
}

async function loadAcceptanceEvents(testMode: boolean): Promise<AcceptanceEventRow[]> {
  const query = db()
    .from("spec_acceptance_events")
    .select("spec_project_id, event_type")
    .in("event_type", ["scope_signoff", "midpoint_accepted", "delivery_accepted"]);
  const { data, error } = await applyTestModeFilter(query as unknown as Filterable, testMode) as unknown as {
    data: AcceptanceEventRow[] | null;
    error: { message: string } | null;
  };
  if (error) {
    console.error("[loadAcceptanceEvents] failed:", error.message);
    return [];
  }
  return data ?? [];
}

async function buildMoneyToCollect(
  projects: ProjectRowMinimal[],
  payments: PaymentRow[],
  acceptanceEvents: AcceptanceEventRow[],
): Promise<TodayItem[]> {
  const items: TodayItem[] = [];

  const projectsById = new Map(projects.map((p) => [p.id, p]));

  // Group acceptance events per project.
  const acceptanceByProject = new Map<string, Set<string>>();
  for (const row of acceptanceEvents) {
    if (!acceptanceByProject.has(row.spec_project_id)) {
      acceptanceByProject.set(row.spec_project_id, new Set());
    }
    acceptanceByProject.get(row.spec_project_id)!.add(row.event_type);
  }

  // Group payments per project.
  const paymentsByProject = new Map<string, Map<string, PaymentRow>>();
  for (const pmt of payments) {
    if (!paymentsByProject.has(pmt.spec_project_id)) {
      paymentsByProject.set(pmt.spec_project_id, new Map());
    }
    paymentsByProject.get(pmt.spec_project_id)!.set(pmt.milestone, pmt);
  }

  const nowMs = Date.now();

  // Per project: which milestones are ready to fire?
  for (const [projectId, events] of acceptanceByProject) {
    const project = projectsById.get(projectId);
    if (!project) continue;
    const pmts = paymentsByProject.get(projectId) ?? new Map<string, PaymentRow>();

    const readyChecks: Array<{
      milestone: "scope_signoff" | "midpoint" | "delivery";
      pricedHint: string;
      uiLabel: string;
    }> = [
      { milestone: "scope_signoff", pricedHint: "P2", uiLabel: "Fire P2 invoice" },
      { milestone: "midpoint", pricedHint: "P3", uiLabel: "Fire P3 invoice" },
      { milestone: "delivery", pricedHint: "P4", uiLabel: "Fire P4 invoice" },
    ];

    for (const check of readyChecks) {
      const acceptanceKey =
        check.milestone === "scope_signoff"
          ? "scope_signoff"
          : check.milestone === "midpoint"
          ? "midpoint_accepted"
          : "delivery_accepted";
      if (!events.has(acceptanceKey)) continue;
      const existing = pmts.get(check.milestone);
      if (existing && existing.status !== "pending") continue;
      // Extra guard for P4: walkthrough_completed_at must be stamped.
      if (check.milestone === "delivery" && !project.walkthrough_completed_at) continue;

      items.push({
        id: `ready-${check.milestone}-${projectId}`,
        description: `Scope cleared for ${projectLabel(project)} — ${check.pricedHint} ready to fire`,
        ageLabel: ageLabelFromIso(project.deposit_paid_at).ageLabel,
        ageMinutes: ageLabelFromIso(project.deposit_paid_at).ageMinutes,
        amountCents: existing?.total_cents,
        primaryAction: { label: check.uiLabel, href: `/admin/spec/${projectId}` },
        deepLink: `/admin/spec/${projectId}`,
      });
    }
  }

  // Overdue / approaching-disable invoices.
  for (const pmt of payments) {
    const project = projectsById.get(pmt.spec_project_id);
    if (!project) continue;

    const isOverdue =
      pmt.status === "overdue" ||
      (pmt.status === "invoiced" &&
        pmt.due_date != null &&
        new Date(pmt.due_date).getTime() < nowMs - 15 * DAY);

    if (!isOverdue) continue;

    const dueIso = pmt.due_date ?? pmt.invoiced_at;
    const ageInfo = ageLabelFromIso(dueIso);
    const daysOver = pmt.due_date
      ? Math.max(0, Math.floor((nowMs - new Date(pmt.due_date).getTime()) / DAY))
      : 0;
    const approachingDisable = daysOver >= 5; // 7-day disable window in 2 days
    items.push({
      id: `overdue-${pmt.id}`,
      description: `${projectLabel(project)} — ${pmt.milestone.toUpperCase()} invoice ${daysOver}d overdue${approachingDisable ? " · non-payment disable in 2d" : ""}`,
      ageLabel: ageInfo.ageLabel,
      ageMinutes: ageInfo.ageMinutes,
      amountCents: pmt.total_cents,
      primaryAction: { label: "Open project", href: `/admin/spec/${project.id}` },
      deepLink: `/admin/spec/${project.id}`,
    });
  }

  return items.sort((a, b) => b.ageMinutes - a.ageMinutes);
}

async function buildBlockedOnApproval(testMode: boolean): Promise<TodayItem[]> {
  const query = db()
    .from("spec_owner_approval_requests")
    .select("id, spec_project_id, requested_at, tier, account_holder_user_id")
    .eq("status", "pending")
    .order("requested_at", { ascending: true });
  const { data, error } = await applyTestModeFilter(query as unknown as Filterable, testMode) as unknown as {
    data:
      | Array<{
          id: string;
          spec_project_id: string;
          requested_at: string;
          tier: string;
          account_holder_user_id: string;
        }>
      | null;
    error: { message: string } | null;
  };
  if (error) {
    console.error("[buildBlockedOnApproval] failed:", error.message);
    return [];
  }

  if (!data || data.length === 0) return [];

  // Load buyer name/email for each project.
  const projectIds = Array.from(new Set(data.map((r) => r.spec_project_id)));
  const { data: projects } = await db()
    .from("spec_projects")
    .select("id, customer_name, customer_email")
    .in("id", projectIds);
  const projectById = new Map(
    (projects ?? []).map((p) => [
      p.id as string,
      { customer_name: p.customer_name as string | null, customer_email: p.customer_email as string },
    ]),
  );

  return data.map((row) => {
    const ageInfo = ageLabelFromIso(row.requested_at);
    const project = projectById.get(row.spec_project_id);
    const label = project ? projectLabel(project) : row.account_holder_user_id;
    return {
      id: `owner-approval-${row.id}`,
      description: `${label} — awaiting owner approval (${row.tier.toUpperCase()})`,
      ageLabel: ageInfo.ageLabel,
      ageMinutes: ageInfo.ageMinutes,
      primaryAction: { label: "Open project", href: `/admin/spec/${row.spec_project_id}` },
      deepLink: `/admin/spec/${row.spec_project_id}`,
    };
  });
}

async function buildDecisionsDue(
  projects: ProjectRowMinimal[],
  payments: PaymentRow[],
  testMode: boolean,
): Promise<TodayItem[]> {
  const items: TodayItem[] = [];
  const projectsById = new Map(projects.map((p) => [p.id, p]));

  // Pending refund requests.
  const refundQ = db()
    .from("spec_refund_requests")
    .select("id, spec_project_id, requested_at, customer_reason_text, is_guarantee_invocation")
    .eq("status", "pending")
    .order("requested_at", { ascending: true });
  const { data: refunds } = (await applyTestModeFilter(refundQ as unknown as Filterable, testMode)) as unknown as {
    data:
      | Array<{
          id: string;
          spec_project_id: string;
          requested_at: string;
          customer_reason_text: string | null;
          is_guarantee_invocation: boolean | null;
        }>
      | null;
  };
  for (const r of refunds ?? []) {
    const project = projectsById.get(r.spec_project_id);
    const label = project ? projectLabel(project) : r.spec_project_id;
    const tag = r.is_guarantee_invocation ? "30-day guarantee" : "Goodwill";
    const ageInfo = ageLabelFromIso(r.requested_at);
    items.push({
      id: `refund-${r.id}`,
      description: `${label} — refund requested · ${tag}`,
      ageLabel: ageInfo.ageLabel,
      ageMinutes: ageInfo.ageMinutes,
      primaryAction: { label: "Review refund", href: `/admin/spec/refunds` },
      deepLink: `/admin/spec/refunds`,
    });
  }

  // Open Stripe disputes (any payment row in 'disputed').
  for (const pmt of payments) {
    if (pmt.status !== "disputed") continue;
    const project = projectsById.get(pmt.spec_project_id);
    const label = project ? projectLabel(project) : pmt.spec_project_id;
    const ageInfo = ageLabelFromIso(pmt.invoiced_at ?? pmt.due_date ?? null);
    items.push({
      id: `dispute-${pmt.id}`,
      description: `${label} — Stripe dispute open on ${pmt.milestone.toUpperCase()}`,
      ageLabel: ageInfo.ageLabel,
      ageMinutes: ageInfo.ageMinutes,
      amountCents: pmt.total_cents,
      primaryAction: { label: "Open project", href: `/admin/spec/${pmt.spec_project_id}` },
      deepLink: `/admin/spec/${pmt.spec_project_id}`,
    });
  }

  // No-show escalations (1+ no-shows recorded).
  for (const p of projects) {
    if ((p.no_show_count ?? 0) < 1) continue;
    const ageInfo = ageLabelFromIso(p.discovery_scheduled_at ?? p.deposit_paid_at ?? null);
    items.push({
      id: `noshow-${p.id}`,
      description: `${projectLabel(p)} — discovery no-show (count: ${p.no_show_count})`,
      ageLabel: ageInfo.ageLabel,
      ageMinutes: ageInfo.ageMinutes,
      primaryAction: { label: "Open project", href: `/admin/spec/${p.id}` },
      deepLink: `/admin/spec/${p.id}`,
    });
  }

  // Related-entity referral flags pending review.
  const referralQ = db()
    .from("spec_referrals")
    .select("id, spec_project_id, referrer_email")
    .eq("status", "review");
  const { data: referrals } = (await applyTestModeFilter(referralQ as unknown as Filterable, testMode)) as unknown as {
    data: Array<{ id: string; spec_project_id: string; referrer_email: string }> | null;
  };
  for (const r of referrals ?? []) {
    const project = projectsById.get(r.spec_project_id);
    const label = project ? projectLabel(project) : r.referrer_email;
    items.push({
      id: `referral-${r.id}`,
      description: `${label} — related-entity referral flag · review payout`,
      ageLabel: "—",
      ageMinutes: 0,
      primaryAction: { label: "Open referral queue", href: `/admin/spec/referrals` },
      deepLink: `/admin/spec/referrals`,
    });
  }

  // Regulated-workflow attestation flagged at intake.
  for (const p of projects) {
    const intake = p.intake_responses;
    if (!intake) continue;
    const attest = (intake as { regulated_workflow_attestation?: unknown }).regulated_workflow_attestation;
    const isFlagged =
      attest === true ||
      attest === "yes" ||
      attest === "true" ||
      (typeof attest === "string" && attest.toLowerCase() === "yes");
    if (!isFlagged) continue;
    const ageInfo = ageLabelFromIso(p.intake_completed_at);
    items.push({
      id: `regulated-${p.id}`,
      description: `${projectLabel(p)} — regulated workflow flagged at intake (review eligibility)`,
      ageLabel: ageInfo.ageLabel,
      ageMinutes: ageInfo.ageMinutes,
      primaryAction: { label: "Open project", href: `/admin/spec/${p.id}` },
      deepLink: `/admin/spec/${p.id}`,
    });
  }

  return items.sort((a, b) => b.ageMinutes - a.ageMinutes);
}

async function buildSlaMisses(projects: ProjectRowMinimal[]): Promise<TodayItem[]> {
  const items: TodayItem[] = [];
  const nowMs = Date.now();
  for (const p of projects) {
    if (p.status !== "building") continue;
    if (!p.last_communication_at) continue;
    const ageMs = nowMs - new Date(p.last_communication_at).getTime();
    if (ageMs < 7 * DAY) continue;
    const ageInfo = ageLabelFromIso(p.last_communication_at);
    items.push({
      id: `sla-comms-${p.id}`,
      description: `${projectLabel(p)} — no contact in ${ageInfo.ageLabel} (building stage SLA)`,
      ageLabel: ageInfo.ageLabel,
      ageMinutes: ageInfo.ageMinutes,
      primaryAction: { label: "Open project", href: `/admin/spec/${p.id}` },
      deepLink: `/admin/spec/${p.id}`,
    });
  }
  return items.sort((a, b) => b.ageMinutes - a.ageMinutes);
}

async function buildRefundDisputeRisk(
  projects: ProjectRowMinimal[],
  testMode: boolean,
): Promise<TodayItem[]> {
  const items: TodayItem[] = [];
  const nowMs = Date.now();

  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const supportProjectIds = projects.filter((p) => p.status === "support").map((p) => p.id);

  if (supportProjectIds.length > 0) {
    const since = new Date(nowMs - 7 * DAY).toISOString();
    const ratingsQ = db()
      .from("spec_satisfaction_ratings")
      .select("spec_project_id, rating, submitted_at")
      .in("spec_project_id", supportProjectIds)
      .gte("submitted_at", since);
    const { data: ratings } = (await applyTestModeFilter(ratingsQ as unknown as Filterable, testMode)) as unknown as {
      data: Array<{ spec_project_id: string; rating: number; submitted_at: string }> | null;
    };
    const lowByProject = new Map<string, { count: number; latest: string }>();
    for (const r of ratings ?? []) {
      if (r.rating > 2) continue;
      const entry = lowByProject.get(r.spec_project_id) ?? { count: 0, latest: r.submitted_at };
      entry.count += 1;
      if (r.submitted_at > entry.latest) entry.latest = r.submitted_at;
      lowByProject.set(r.spec_project_id, entry);
    }
    for (const [projectId, info] of lowByProject) {
      const project = projectsById.get(projectId);
      if (!project) continue;
      const ageInfo = ageLabelFromIso(info.latest);
      items.push({
        id: `csat-${projectId}`,
        description: `${projectLabel(project)} — ${info.count} satisfaction rating(s) ≤ 2 in last 7d`,
        ageLabel: ageInfo.ageLabel,
        ageMinutes: ageInfo.ageMinutes,
        primaryAction: { label: "Open project", href: `/admin/spec/${projectId}` },
        deepLink: `/admin/spec/${projectId}`,
      });
    }
  }

  // Open critical tickets > 48h old.
  const ticketsQ = db()
    .from("spec_support_tickets")
    .select("id, spec_project_id, opened_at, severity, status")
    .eq("status", "open")
    .eq("severity", "critical");
  const { data: tickets } = (await applyTestModeFilter(ticketsQ as unknown as Filterable, testMode)) as unknown as {
    data:
      | Array<{ id: string; spec_project_id: string; opened_at: string; severity: string; status: string }>
      | null;
  };
  for (const t of tickets ?? []) {
    const ageMs = nowMs - new Date(t.opened_at).getTime();
    if (ageMs < 48 * HOUR) continue;
    const project = projectsById.get(t.spec_project_id);
    if (!project) continue;
    const ageInfo = ageLabelFromIso(t.opened_at);
    items.push({
      id: `critical-ticket-${t.id}`,
      description: `${projectLabel(project)} — critical ticket open ${ageInfo.ageLabel}`,
      ageLabel: ageInfo.ageLabel,
      ageMinutes: ageInfo.ageMinutes,
      primaryAction: { label: "Open project", href: `/admin/spec/${t.spec_project_id}` },
      deepLink: `/admin/spec/${t.spec_project_id}`,
    });
  }

  // Approaching 30-day guarantee window expiry, no walkthrough recording, no open tickets.
  const ticketsByProject = new Map<string, number>();
  for (const t of tickets ?? []) {
    ticketsByProject.set(t.spec_project_id, (ticketsByProject.get(t.spec_project_id) ?? 0) + 1);
  }
  for (const p of projects) {
    if (p.status !== "support") continue;
    if (!p.walkthrough_completed_at) continue;
    const elapsed = nowMs - new Date(p.walkthrough_completed_at).getTime();
    if (elapsed < 25 * DAY || elapsed >= 30 * DAY) continue;
    if (p.walkthrough_recording_url) continue;
    if ((ticketsByProject.get(p.id) ?? 0) > 0) continue;
    const daysLeft = 30 - Math.floor(elapsed / DAY);
    items.push({
      id: `guarantee-${p.id}`,
      description: `${projectLabel(p)} — 30-day guarantee expires in ${daysLeft}d · no recording, no tickets`,
      ageLabel: `${daysLeft}d left`,
      ageMinutes: 0,
      primaryAction: { label: "Open project", href: `/admin/spec/${p.id}` },
      deepLink: `/admin/spec/${p.id}`,
    });
  }

  return items.sort((a, b) => b.ageMinutes - a.ageMinutes);
}

async function buildNextBestAction(projects: ProjectRowMinimal[]): Promise<TodayItem[]> {
  const items: TodayItem[] = [];
  const nowMs = Date.now();

  for (const p of projects) {
    // awaiting_deposit + checkout token expiring within 24h
    if (
      p.status === "awaiting_deposit" &&
      p.checkout_token_expires_at &&
      new Date(p.checkout_token_expires_at).getTime() - nowMs < DAY &&
      new Date(p.checkout_token_expires_at).getTime() > nowMs
    ) {
      items.push({
        id: `checkout-expiring-${p.id}`,
        description: `${projectLabel(p)} — checkout link expires within 24h · nudge buyer`,
        ageLabel: ageLabelFromIso(p.checkout_token_expires_at).ageLabel,
        ageMinutes: 0,
        primaryAction: { label: "Open project", href: `/admin/spec/${p.id}` },
        deepLink: `/admin/spec/${p.id}`,
      });
    }

    // deposit_paid + no intake_completed_at + paid > 7d ago + no discovery_scheduled_at
    if (
      p.status === "deposit_paid" &&
      !p.intake_completed_at &&
      !p.discovery_scheduled_at &&
      p.deposit_paid_at &&
      nowMs - new Date(p.deposit_paid_at).getTime() > 7 * DAY
    ) {
      const ageInfo = ageLabelFromIso(p.deposit_paid_at);
      items.push({
        id: `intake-stalled-${p.id}`,
        description: `${projectLabel(p)} — intake outstanding ${ageInfo.ageLabel} after deposit · send Calendly`,
        ageLabel: ageInfo.ageLabel,
        ageMinutes: ageInfo.ageMinutes,
        primaryAction: { label: "Open project", href: `/admin/spec/${p.id}` },
        deepLink: `/admin/spec/${p.id}`,
      });
    }

    // customer_requested holds approaching 90d expiry
    if (
      p.status === "on_hold" &&
      p.hold_type === "customer_requested" &&
      p.on_hold_expires_at
    ) {
      const left = new Date(p.on_hold_expires_at).getTime() - nowMs;
      if (left > 0 && left < 7 * DAY) {
        const daysLeft = Math.ceil(left / DAY);
        items.push({
          id: `hold-expiring-${p.id}`,
          description: `${projectLabel(p)} — customer-requested hold expires in ${daysLeft}d`,
          ageLabel: `${daysLeft}d left`,
          ageMinutes: 0,
          primaryAction: { label: "Open project", href: `/admin/spec/${p.id}` },
          deepLink: `/admin/spec/${p.id}`,
        });
      }
    }
  }

  return items.sort((a, b) => b.ageMinutes - a.ageMinutes);
}

async function computeTodayUncached(testMode: boolean): Promise<TodaySection[]> {
  const [projects, payments, acceptanceEvents] = await Promise.all([
    loadActiveProjects(testMode),
    loadAllPayments(testMode),
    loadAcceptanceEvents(testMode),
  ]);

  const [moneyToCollect, blockedOnApproval, decisionsDue, slaMisses, refundDisputeRisk, nextBestAction] =
    await Promise.all([
      buildMoneyToCollect(projects, payments, acceptanceEvents),
      buildBlockedOnApproval(testMode),
      buildDecisionsDue(projects, payments, testMode),
      buildSlaMisses(projects),
      buildRefundDisputeRisk(projects, testMode),
      buildNextBestAction(projects),
    ]);

  return [
    { key: "money_to_collect", label: "MONEY TO COLLECT", items: moneyToCollect },
    { key: "blocked_on_approval", label: "BLOCKED ON OWNER APPROVAL", items: blockedOnApproval },
    { key: "decisions_due", label: "DECISIONS DUE", items: decisionsDue },
    { key: "sla_misses", label: "SLA MISSES", items: slaMisses },
    { key: "refund_dispute_risk", label: "REFUND / DISPUTE RISK", items: refundDisputeRisk },
    { key: "next_best_action", label: "NEXT BEST ACTION", items: nextBestAction },
  ];
}

const cachedTodayLive = unstable_cache(
  async () => computeTodayUncached(false),
  ["spec-today-live"],
  { revalidate: 30, tags: ["spec-today"] },
);

const cachedTodayTest = unstable_cache(
  async () => computeTodayUncached(true),
  ["spec-today-test"],
  { revalidate: 30, tags: ["spec-today"] },
);

export async function getTodayQueue(testMode: boolean): Promise<TodaySection[]> {
  return testMode ? cachedTodayTest() : cachedTodayLive();
}

// ─── Capacity ────────────────────────────────────────────────────────────────

interface CapacityConfigRow {
  tier: SpecTier;
  slot_ceiling: number;
  is_accepting_bookings: boolean;
  manual_next_start_override: string | null;
  public_note: string | null;
}

async function loadCapacityConfig(): Promise<CapacityConfigRow[]> {
  const { data, error } = await db()
    .from("spec_capacity")
    .select("tier, slot_ceiling, is_accepting_bookings, manual_next_start_override, public_note")
    .order("tier", { ascending: true });
  if (error) {
    console.error("[loadCapacityConfig] failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    tier: ofTier(r.tier as string),
    slot_ceiling: r.slot_ceiling as number,
    is_accepting_bookings: !!r.is_accepting_bookings,
    manual_next_start_override: (r.manual_next_start_override as string | null) ?? null,
    public_note: (r.public_note as string | null) ?? null,
  }));
}

async function loadConsumingProjects(testMode: boolean): Promise<
  Array<{
    tier: SpecTier;
    status: SpecProjectStatus;
    hold_type: SpecHoldType | null;
  }>
> {
  const query = db()
    .from("spec_projects")
    .select("tier, status, hold_type")
    .in("status", [
      "awaiting_deposit",
      "deposit_paid",
      "discovery",
      "building",
      "on_hold",
    ]);
  const { data } = (await applyTestModeFilter(query as unknown as Filterable, testMode)) as unknown as {
    data: Array<{ tier: string; status: SpecProjectStatus; hold_type: SpecHoldType | null }> | null;
  };
  return (data ?? []).map((r) => ({ ...r, tier: ofTier(r.tier) }));
}

async function loadSnapshotRefreshedAt(): Promise<string | null> {
  const { data, error } = await db()
    .from("spec_public_board_snapshot")
    .select("refreshed_at")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[loadSnapshotRefreshedAt] failed:", error.message);
    return null;
  }
  return (data?.refreshed_at as string | null) ?? null;
}

export async function getCapacity(testMode: boolean): Promise<{ rows: CapacityRow[]; refreshedAt: string | null }> {
  const [config, consuming, refreshedAt] = await Promise.all([
    loadCapacityConfig(),
    loadConsumingProjects(testMode),
    loadSnapshotRefreshedAt(),
  ]);

  const rows: CapacityRow[] = config.map((c) => {
    const projectsForTier = consuming.filter((p) => p.tier === c.tier);
    const active = projectsForTier.filter(
      (p) =>
        p.status === "discovery" ||
        p.status === "building" ||
        (p.status === "on_hold" && p.hold_type === "ops_blocked"),
    ).length;
    const queued = projectsForTier.filter(
      (p) => p.status === "awaiting_deposit" || p.status === "deposit_paid",
    ).length;
    const holdCustomer = projectsForTier.filter(
      (p) => p.status === "on_hold" && p.hold_type === "customer_requested",
    ).length;
    const holdOps = projectsForTier.filter(
      (p) => p.status === "on_hold" && p.hold_type === "ops_blocked",
    ).length;
    return {
      tier: c.tier,
      slotCeiling: c.slot_ceiling,
      active,
      queued,
      holdCustomerRequested: holdCustomer,
      holdOpsBlocked: holdOps,
      isAcceptingBookings: c.is_accepting_bookings,
      manualNextStartOverride: c.manual_next_start_override,
      publicNote: c.public_note,
      snapshotRefreshedAt: refreshedAt,
    };
  });

  return { rows, refreshedAt };
}

// ─── Kanban + side counters ──────────────────────────────────────────────────

interface KanbanRow {
  id: string;
  status: SpecProjectStatus;
  tier: SpecTier;
  customer_name: string | null;
  customer_email: string;
  hold_type: SpecHoldType | null;
  is_test: boolean;
  // Status-anchor timestamps (used for days-in-status approximation).
  deposit_paid_at: string | null;
  intake_completed_at: string | null;
  discovery_started_at: string | null;
  build_started_at: string | null;
  walkthrough_completed_at: string | null;
  retainer_started_at: string | null;
  completed_at: string | null;
  on_hold_at: string | null;
  scope_doc_signed_at: string | null;
  cancelled_at: string | null;
  refunded_at: string | null;
  stalled_at: string | null;
  owner_approval_requested_at: string | null;
}

function statusAnchorMs(row: KanbanRow): number {
  const candidates: Array<string | null> = [];
  switch (row.status) {
    case "awaiting_owner_approval":
      candidates.push(row.owner_approval_requested_at);
      break;
    case "awaiting_deposit":
      candidates.push(row.owner_approval_requested_at);
      break;
    case "deposit_paid":
      candidates.push(row.deposit_paid_at);
      break;
    case "discovery":
      candidates.push(row.discovery_started_at, row.deposit_paid_at);
      break;
    case "building":
      candidates.push(row.build_started_at, row.scope_doc_signed_at);
      break;
    case "on_hold":
    case "stalled_on_hold":
      candidates.push(row.on_hold_at);
      break;
    case "support":
      candidates.push(row.walkthrough_completed_at);
      break;
    case "on_retainer":
      candidates.push(row.retainer_started_at);
      break;
    case "completed":
      candidates.push(row.completed_at);
      break;
    case "cancelled":
      candidates.push(row.cancelled_at);
      break;
    case "refunded":
      candidates.push(row.refunded_at);
      break;
    case "stalled":
      candidates.push(row.stalled_at);
      break;
  }
  for (const c of candidates) {
    if (c) return new Date(c).getTime();
  }
  return Date.now();
}

interface PaymentSumRow {
  spec_project_id: string;
  total_cents: number;
  status: SpecPaymentStatus;
}

async function loadAllPaymentsForKanban(testMode: boolean): Promise<PaymentSumRow[]> {
  const q = db().from("spec_payments").select("spec_project_id, total_cents, status");
  const { data } = (await applyTestModeFilter(q as unknown as Filterable, testMode)) as unknown as {
    data: PaymentSumRow[] | null;
  };
  return data ?? [];
}

function nextActionFor(row: KanbanRow, pendingMs: number): string | null {
  switch (row.status) {
    case "awaiting_owner_approval":
      return "Owner approval pending";
    case "awaiting_deposit":
      return "Deposit link sent";
    case "deposit_paid":
      return row.intake_completed_at ? "Schedule discovery" : "Intake outstanding";
    case "discovery":
      return row.scope_doc_signed_at ? "Begin build" : "Draft scope doc";
    case "building":
      return row.walkthrough_completed_at ? "Schedule support" : "Build in progress";
    case "on_hold":
      return row.hold_type === "ops_blocked" ? "OPS blocked · resolve" : "Customer hold";
    case "support":
      return "Schedule walkthrough recording";
    case "on_retainer":
      return "Retainer active";
    case "completed":
      return null;
    default:
      return pendingMs > 0 ? `Idle ${Math.floor(pendingMs / DAY)}d` : null;
  }
}

export async function getKanban(
  testMode: boolean,
): Promise<{ columns: KanbanColumn[]; counters: KanbanSideCounters }> {
  const projectsQuery = db()
    .from("spec_projects")
    .select(
      "id, status, tier, customer_name, customer_email, hold_type, is_test, deposit_paid_at, intake_completed_at, discovery_started_at, build_started_at, walkthrough_completed_at, retainer_started_at, completed_at, on_hold_at, scope_doc_signed_at, cancelled_at, refunded_at, stalled_at, owner_approval_requested_at",
    );
  const { data: projects, error } = (await applyTestModeFilter(
    projectsQuery as unknown as Filterable,
    testMode,
  )) as unknown as {
    data: KanbanRow[] | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error("[getKanban] failed:", error.message);
  }

  const allProjects = (projects ?? []).map((p) => ({ ...p, tier: ofTier(p.tier) }));
  const payments = await loadAllPaymentsForKanban(testMode);

  const committedByProject = new Map<string, number>();
  for (const pmt of payments) {
    if (pmt.status === "refunded" || pmt.status === "voided") continue;
    const prev = committedByProject.get(pmt.spec_project_id) ?? 0;
    committedByProject.set(pmt.spec_project_id, prev + (pmt.total_cents ?? 0));
  }

  const cardsByStatus = new Map<SpecProjectStatus, KanbanCard[]>();
  for (const status of KANBAN_COLUMNS) {
    cardsByStatus.set(status, []);
  }

  let stalled = 0;
  let stalledOnHold = 0;
  let cancelled = 0;
  let refunded = 0;

  const nowMs = Date.now();
  for (const project of allProjects) {
    if (project.status === "stalled") {
      stalled += 1;
      continue;
    }
    if (project.status === "stalled_on_hold") {
      stalledOnHold += 1;
      continue;
    }
    if (project.status === "cancelled") {
      cancelled += 1;
      continue;
    }
    if (project.status === "refunded") {
      refunded += 1;
      continue;
    }
    if (!KANBAN_COLUMNS.includes(project.status)) continue;

    const anchorMs = statusAnchorMs(project);
    const daysInStatus = Math.max(0, Math.floor((nowMs - anchorMs) / DAY));
    const pendingMs = nowMs - anchorMs;
    const card: KanbanCard = {
      id: project.id,
      customerLabel: projectLabel({
        customer_name: project.customer_name,
        customer_email: project.customer_email,
      }),
      tier: project.tier,
      status: project.status,
      holdType: project.hold_type,
      daysInStatus,
      totalCommittedCents: committedByProject.get(project.id) ?? 0,
      nextActionLabel: nextActionFor(project, pendingMs),
      isTest: !!project.is_test,
    };
    cardsByStatus.get(project.status)!.push(card);
  }

  const columns: KanbanColumn[] = KANBAN_COLUMNS.map((status) => {
    const cards = cardsByStatus.get(status) ?? [];
    if (status === "on_hold") {
      // Visual split: customer_requested first (top), then ops_blocked (bottom).
      cards.sort((a, b) => {
        const order = (h: SpecHoldType | null) => (h === "customer_requested" ? 0 : 1);
        if (order(a.holdType) !== order(b.holdType)) return order(a.holdType) - order(b.holdType);
        return b.daysInStatus - a.daysInStatus;
      });
    } else {
      cards.sort((a, b) => b.daysInStatus - a.daysInStatus);
    }
    return { status, cards };
  });

  return {
    columns,
    counters: { stalled, stalledOnHold, cancelled, refunded },
  };
}

// ─── Revenue ─────────────────────────────────────────────────────────────────

async function computeRevenueUncached(testMode: boolean): Promise<RevenueSummary> {
  const q = db()
    .from("spec_payments")
    .select("total_cents, status, paid_at, due_date, refunded_at, amount_refunded_cents");
  const { data, error } = (await applyTestModeFilter(q as unknown as Filterable, testMode)) as unknown as {
    data:
      | Array<{
          total_cents: number;
          status: SpecPaymentStatus;
          paid_at: string | null;
          due_date: string | null;
          refunded_at: string | null;
          amount_refunded_cents: number | null;
        }>
      | null;
    error: { message: string } | null;
  };
  if (error) {
    console.error("[computeRevenue] failed:", error.message);
  }

  const rows = data ?? [];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const quarter = Math.floor(now.getMonth() / 3);
  const quarterStart = new Date(now.getFullYear(), quarter * 3, 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  let paidThisMonth = 0;
  let paidThisQuarter = 0;
  let paidYtd = 0;
  let pending = 0;
  let overdue = 0;
  let refundedTotal = 0;

  for (const r of rows) {
    if (r.paid_at && (r.status === "paid" || r.status === "partially_refunded")) {
      const paidAt = new Date(r.paid_at);
      const paidNet = (r.total_cents ?? 0) - (r.amount_refunded_cents ?? 0);
      if (paidAt >= monthStart) paidThisMonth += paidNet;
      if (paidAt >= quarterStart) paidThisQuarter += paidNet;
      if (paidAt >= yearStart) paidYtd += paidNet;
    }
    if (r.status === "invoiced") {
      pending += r.total_cents ?? 0;
    }
    if (r.status === "overdue") {
      overdue += r.total_cents ?? 0;
    }
    if (r.status === "invoiced" && r.due_date && new Date(r.due_date) < now) {
      // Stale 'invoiced' past due-date still surfaces in overdue total (catches
      // engagements where the overdue cron hasn't transitioned the row yet).
      overdue += r.total_cents ?? 0;
      pending -= r.total_cents ?? 0;
    }
    if (r.amount_refunded_cents) {
      refundedTotal += r.amount_refunded_cents;
    }
  }

  // 12-month trend (descending months → reverse for display).
  const monthlyTrend: RevenuePoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const monthAt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(monthAt.getFullYear(), monthAt.getMonth() + 1, 1);
    const label = `${monthAt.getFullYear()}-${String(monthAt.getMonth() + 1).padStart(2, "0")}`;
    let cents = 0;
    for (const r of rows) {
      if (!r.paid_at) continue;
      const paidAt = new Date(r.paid_at);
      if (paidAt < monthAt || paidAt >= monthEnd) continue;
      if (r.status !== "paid" && r.status !== "partially_refunded") continue;
      cents += (r.total_cents ?? 0) - (r.amount_refunded_cents ?? 0);
    }
    monthlyTrend.push({ label, cents });
  }

  return {
    paidThisMonthCents: paidThisMonth,
    paidThisQuarterCents: paidThisQuarter,
    paidYtdCents: paidYtd,
    pendingCents: Math.max(0, pending),
    overdueCents: overdue,
    refundedCents: refundedTotal,
    monthlyTrend,
  };
}

const cachedRevenueLive = unstable_cache(
  async () => computeRevenueUncached(false),
  ["spec-revenue-live"],
  { revalidate: 300, tags: ["spec-revenue"] },
);
const cachedRevenueTest = unstable_cache(
  async () => computeRevenueUncached(true),
  ["spec-revenue-test"],
  { revalidate: 300, tags: ["spec-revenue"] },
);

export async function getRevenue(testMode: boolean): Promise<RevenueSummary> {
  return testMode ? cachedRevenueTest() : cachedRevenueLive();
}

// ─── Pipeline velocity ───────────────────────────────────────────────────────

async function computeVelocityUncached(testMode: boolean): Promise<PipelineVelocity> {
  const q = db()
    .from("spec_projects")
    .select(
      "id, status, tier, customer_name, customer_email, deposit_paid_at, intake_completed_at, discovery_started_at, build_started_at, walkthrough_completed_at, retainer_started_at, completed_at, on_hold_at, scope_doc_signed_at, cancelled_at, refunded_at, stalled_at, owner_approval_requested_at",
    );
  const { data, error } = (await applyTestModeFilter(q as unknown as Filterable, testMode)) as unknown as {
    data: KanbanRow[] | null;
    error: { message: string } | null;
  };
  if (error) {
    console.error("[computeVelocity] failed:", error.message);
  }

  const rows = (data ?? []).map((r) => ({ ...r, tier: ofTier(r.tier) }));
  const nowMs = Date.now();

  // Per-status: average days in current status across rows currently in that status.
  const perStatusBuckets = new Map<SpecProjectStatus, number[]>();
  for (const status of KANBAN_COLUMNS) perStatusBuckets.set(status, []);
  for (const row of rows) {
    if (!KANBAN_COLUMNS.includes(row.status)) continue;
    const days = Math.max(0, Math.floor((nowMs - statusAnchorMs(row)) / DAY));
    perStatusBuckets.get(row.status)!.push(days);
  }
  const perStatus: VelocityRow[] = KANBAN_COLUMNS.map((status) => {
    const sample = perStatusBuckets.get(status) ?? [];
    const avg =
      sample.length === 0 ? 0 : Math.round(sample.reduce((a, b) => a + b, 0) / sample.length);
    return { status, avgDaysCurrent: avg, sampleSize: sample.length };
  });

  // Slowest projects — top 5 by daysInStatus among active columns.
  const slowest: SlowestProject[] = rows
    .filter((r) => KANBAN_COLUMNS.includes(r.status) && r.status !== "completed")
    .map((r) => ({
      id: r.id,
      customerLabel: projectLabel({
        customer_name: r.customer_name,
        customer_email: r.customer_email,
      }),
      tier: r.tier,
      status: r.status,
      daysInStatus: daysBetween(new Date(statusAnchorMs(r)).toISOString()),
    }))
    .sort((a, b) => b.daysInStatus - a.daysInStatus)
    .slice(0, 5);

  // Cycle time per tier: deposit_paid_at → walkthrough_completed_at.
  const cycleBucket = new Map<SpecTier, number[]>();
  for (const tier of ["setup", "build", "enterprise"] as SpecTier[]) {
    cycleBucket.set(tier, []);
  }
  for (const r of rows) {
    if (!r.deposit_paid_at || !r.walkthrough_completed_at) continue;
    const days = Math.max(
      0,
      Math.floor(
        (new Date(r.walkthrough_completed_at).getTime() - new Date(r.deposit_paid_at).getTime()) /
          DAY,
      ),
    );
    cycleBucket.get(r.tier)?.push(days);
  }
  const cycleTime: CycleTimeRow[] = (["setup", "build", "enterprise"] as SpecTier[]).map((tier) => {
    const sample = cycleBucket.get(tier) ?? [];
    const avg =
      sample.length === 0
        ? null
        : Math.round(sample.reduce((a, b) => a + b, 0) / sample.length);
    return { tier, avgDays: avg, sampleSize: sample.length };
  });

  return { perStatus, slowest, cycleTime };
}

const cachedVelocityLive = unstable_cache(
  async () => computeVelocityUncached(false),
  ["spec-velocity-live"],
  { revalidate: 300, tags: ["spec-velocity"] },
);
const cachedVelocityTest = unstable_cache(
  async () => computeVelocityUncached(true),
  ["spec-velocity-test"],
  { revalidate: 300, tags: ["spec-velocity"] },
);

export async function getPipelineVelocity(testMode: boolean): Promise<PipelineVelocity> {
  return testMode ? cachedVelocityTest() : cachedVelocityLive();
}

// ─── Top-level overview composition ──────────────────────────────────────────

export async function getOverviewSnapshot(testMode: boolean): Promise<SpecOverviewSnapshot> {
  const [today, capacity, kanban, revenue, velocity] = await Promise.all([
    getTodayQueue(testMode),
    getCapacity(testMode),
    getKanban(testMode),
    getRevenue(testMode),
    getPipelineVelocity(testMode),
  ]);

  return {
    today,
    capacity: capacity.rows,
    kanbanColumns: kanban.columns,
    kanbanCounters: kanban.counters,
    revenue,
    velocity,
    snapshotRefreshedAt: capacity.refreshedAt,
    testMode,
  };
}

// ─── Refund queue (F.3) ──────────────────────────────────────────────────────

interface RefundRequestRowRaw {
  id: string;
  spec_project_id: string;
  request_source: SpecRefundRequestSource;
  customer_reason_text: string | null;
  requested_at: string;
  processed_at: string | null;
  processed_by_user_id: string | null;
  is_goodwill: boolean | null;
  is_guarantee_invocation: boolean | null;
  status: SpecRefundRequestStatus;
  is_test: boolean;
  total_refund_cents: number | null;
  refund_breakdown: unknown;
  stripe_refund_ids: unknown;
  denied_at?: string | null;
  denial_reason_text?: string | null;
  denied_by_user_id?: string | null;
}

interface RefundProjectRowRaw {
  id: string;
  tier: string;
  status: SpecProjectStatus;
  customer_name: string | null;
  customer_email: string;
  walkthrough_completed_at: string | null;
}

interface RefundPaymentRowRaw {
  id: string;
  spec_project_id: string;
  milestone: SpecPaymentMilestone;
  status: SpecPaymentStatus;
  total_cents: number;
  amount_refunded_cents: number | null;
  stripe_payment_intent_id: string | null;
  stripe_invoice_id: string | null;
  paid_at: string | null;
  invoiced_at: string | null;
  due_date: string | null;
}

async function loadRefundRequests(
  statuses: readonly SpecRefundRequestStatus[],
  testMode: boolean,
): Promise<RefundRequestRowRaw[]> {
  const query = db()
    .from("spec_refund_requests")
    .select(
      "id, spec_project_id, request_source, customer_reason_text, requested_at, processed_at, processed_by_user_id, is_goodwill, is_guarantee_invocation, status, is_test, total_refund_cents, refund_breakdown, stripe_refund_ids, denied_at, denial_reason_text, denied_by_user_id",
    )
    .in("status", statuses as string[])
    .order("requested_at", { ascending: true });
  const { data, error } = (await applyTestModeFilter(
    query as unknown as Filterable,
    testMode,
  )) as unknown as {
    data: RefundRequestRowRaw[] | null;
    error: { message: string } | null;
  };
  if (error) {
    console.error("[loadRefundRequests] failed:", error.message);
    return [];
  }
  return data ?? [];
}

async function loadRefundProjects(
  projectIds: string[],
): Promise<Map<string, RefundProjectRowRaw>> {
  if (projectIds.length === 0) return new Map();
  const { data, error } = await db()
    .from("spec_projects")
    .select(
      "id, tier, status, customer_name, customer_email, walkthrough_completed_at",
    )
    .in("id", projectIds);
  if (error) {
    console.error("[loadRefundProjects] failed:", error.message);
    return new Map();
  }
  return new Map(
    (data ?? []).map((row) => [
      (row as RefundProjectRowRaw).id,
      row as RefundProjectRowRaw,
    ]),
  );
}

async function loadRefundPayments(
  projectIds: string[],
): Promise<Map<string, RefundPaymentRowRaw[]>> {
  if (projectIds.length === 0) return new Map();
  const { data, error } = await db()
    .from("spec_payments")
    .select(
      "id, spec_project_id, milestone, status, total_cents, amount_refunded_cents, stripe_payment_intent_id, stripe_invoice_id, paid_at, invoiced_at, due_date",
    )
    .in("spec_project_id", projectIds);
  if (error) {
    console.error("[loadRefundPayments] failed:", error.message);
    return new Map();
  }
  const out = new Map<string, RefundPaymentRowRaw[]>();
  for (const row of data ?? []) {
    const pid = (row as RefundPaymentRowRaw).spec_project_id;
    if (!out.has(pid)) out.set(pid, []);
    out.get(pid)!.push(row as RefundPaymentRowRaw);
  }
  return out;
}

function toPaymentSummary(row: RefundPaymentRowRaw): SpecRefundPaymentSummary {
  return {
    id: row.id,
    milestone: row.milestone,
    status: row.status,
    totalCents: row.total_cents,
    amountRefundedCents: row.amount_refunded_cents,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeInvoiceId: row.stripe_invoice_id,
    paidAt: row.paid_at,
    invoicedAt: row.invoiced_at,
    dueDate: row.due_date,
  };
}

function computeEligibility(
  project: RefundProjectRowRaw | undefined,
  payments: RefundPaymentRowRaw[],
  guaranteeAlreadyInvoked: boolean,
): SpecRefundEligibility {
  const nowMs = Date.now();
  let withinGuarantee = false;
  let daysSince: number | null = null;
  if (project?.walkthrough_completed_at) {
    const ms = nowMs - new Date(project.walkthrough_completed_at).getTime();
    daysSince = Math.floor(ms / DAY);
    withinGuarantee = ms <= GUARANTEE_REFUND_WINDOW_DAYS * DAY;
  }
  const hasDispute = payments.some((p) => p.status === "disputed");
  // `non_payment` is a `disabled_reason` on `spec_module_entitlements` set when
  // the customer's invoice ages past the grace window. Surfacing that signal
  // here means flagging projects with an overdue payment row — a sufficient
  // approximation for the queue chip (the full check happens in the actual
  // entitlement record, but the queue UI uses the payment-status proxy to keep
  // the read narrow).
  const hasNonPaymentDisable = payments.some((p) => p.status === "overdue");

  return {
    withinGuaranteeWindow: withinGuarantee,
    daysSinceWalkthrough: daysSince,
    hasActiveDispute: hasDispute,
    hasNonPaymentDisable,
    // Material-breach is operator-judgment; the queue shows a slot for it but
    // surfaces it as `false` by default. The deny-refund action lets Jackson
    // attach a denial reason explaining the breach if applicable.
    materialBreachFlag: false,
    guaranteeAlreadyInvoked,
  };
}

function ageLabel(iso: string): string {
  return ageLabelFromIso(iso).ageLabel;
}

async function buildRefundQueueRows(
  statuses: readonly SpecRefundRequestStatus[],
  testMode: boolean,
): Promise<SpecRefundQueueRow[]> {
  const refunds = await loadRefundRequests(statuses, testMode);
  if (refunds.length === 0) return [];

  const projectIds = Array.from(new Set(refunds.map((r) => r.spec_project_id)));
  const [projects, paymentsByProject] = await Promise.all([
    loadRefundProjects(projectIds),
    loadRefundPayments(projectIds),
  ]);

  // For each project, find any other refund row with `is_guarantee_invocation = true`
  // already in a non-rejected status — used in the eligibility chip.
  const guaranteeAlreadyByProject = new Map<string, boolean>();
  for (const r of refunds) {
    if (!r.is_guarantee_invocation) continue;
    if (r.status === "denied" || r.status === "failed") continue;
    guaranteeAlreadyByProject.set(r.spec_project_id, true);
  }

  return refunds.map((r) => {
    const project = projects.get(r.spec_project_id);
    const projectPayments = paymentsByProject.get(r.spec_project_id) ?? [];
    const eligibility = computeEligibility(
      project,
      projectPayments,
      // The CURRENT row's own status doesn't count toward "already invoked".
      r.status === "denied" || r.status === "failed"
        ? false
        : (guaranteeAlreadyByProject.get(r.spec_project_id) ?? false) &&
            !!r.is_guarantee_invocation === false,
    );

    return {
      id: r.id,
      specProjectId: r.spec_project_id,
      requestSource: r.request_source,
      isGuaranteeInvocation: !!r.is_guarantee_invocation,
      isGoodwill: !!r.is_goodwill,
      status: r.status,
      customerReasonText: r.customer_reason_text,
      requestedAt: r.requested_at,
      requestedAgeLabel: ageLabel(r.requested_at),
      processedAt: r.processed_at,
      processedByUserId: r.processed_by_user_id,
      isTest: r.is_test,
      totalRefundCents: r.total_refund_cents,
      projectTier: ofTier(project?.tier),
      projectStatus: project?.status ?? "deposit_paid",
      customerName: project?.customer_name ?? null,
      customerEmail: project?.customer_email ?? "",
      walkthroughCompletedAt: project?.walkthrough_completed_at ?? null,
      payments: projectPayments.map(toPaymentSummary),
      eligibility,
    };
  });
}

export async function getPendingRefundRequests(
  testMode: boolean,
): Promise<SpecRefundQueueRow[]> {
  return buildRefundQueueRows(["pending"], testMode);
}

export async function getProcessedRefundRequests(
  testMode: boolean,
  limit = 25,
): Promise<SpecRefundQueueRow[]> {
  const rows = await buildRefundQueueRows(
    ["processed", "partial", "denied", "failed"],
    testMode,
  );
  // Most-recent first for the processed-history rail.
  return rows
    .sort((a, b) => {
      const aMs = a.processedAt ? new Date(a.processedAt).getTime() : 0;
      const bMs = b.processedAt ? new Date(b.processedAt).getTime() : 0;
      return bMs - aMs;
    })
    .slice(0, limit);
}

export interface SpecRefundDetail extends SpecRefundQueueRow {
  refundBreakdown: unknown;
  stripeRefundIds: unknown;
  deniedAt: string | null;
  denialReasonText: string | null;
  deniedByUserId: string | null;
}

export async function getRefundRequestDetail(
  refundRequestId: string,
): Promise<SpecRefundDetail | null> {
  const { data: refund, error } = await db()
    .from("spec_refund_requests")
    .select(
      "id, spec_project_id, request_source, customer_reason_text, requested_at, processed_at, processed_by_user_id, is_goodwill, is_guarantee_invocation, status, is_test, total_refund_cents, refund_breakdown, stripe_refund_ids, denied_at, denial_reason_text, denied_by_user_id",
    )
    .eq("id", refundRequestId)
    .maybeSingle();
  if (error || !refund) {
    if (error) console.error("[getRefundRequestDetail] failed:", error.message);
    return null;
  }
  const r = refund as RefundRequestRowRaw;
  const [projects, paymentsByProject] = await Promise.all([
    loadRefundProjects([r.spec_project_id]),
    loadRefundPayments([r.spec_project_id]),
  ]);
  const project = projects.get(r.spec_project_id);
  const projectPayments = paymentsByProject.get(r.spec_project_id) ?? [];
  const eligibility = computeEligibility(project, projectPayments, false);

  return {
    id: r.id,
    specProjectId: r.spec_project_id,
    requestSource: r.request_source,
    isGuaranteeInvocation: !!r.is_guarantee_invocation,
    isGoodwill: !!r.is_goodwill,
    status: r.status,
    customerReasonText: r.customer_reason_text,
    requestedAt: r.requested_at,
    requestedAgeLabel: ageLabel(r.requested_at),
    processedAt: r.processed_at,
    processedByUserId: r.processed_by_user_id,
    isTest: r.is_test,
    totalRefundCents: r.total_refund_cents,
    projectTier: ofTier(project?.tier),
    projectStatus: project?.status ?? "deposit_paid",
    customerName: project?.customer_name ?? null,
    customerEmail: project?.customer_email ?? "",
    walkthroughCompletedAt: project?.walkthrough_completed_at ?? null,
    payments: projectPayments.map(toPaymentSummary),
    eligibility,
    refundBreakdown: r.refund_breakdown ?? null,
    stripeRefundIds: r.stripe_refund_ids ?? null,
    deniedAt: r.denied_at ?? null,
    denialReasonText: r.denial_reason_text ?? null,
    deniedByUserId: r.denied_by_user_id ?? null,
  };
}

// ─── Owner approval queue (F.3) ──────────────────────────────────────────────

interface OwnerApprovalRowRaw {
  id: string;
  spec_project_id: string;
  buyer_user_id: string;
  account_holder_user_id: string;
  linked_company_id: string;
  tier: string;
  approved_total_cents: number;
  approved_deposit_cents: number;
  requested_at: string;
  status: SpecOwnerApprovalStatus;
  is_test: boolean;
}

export async function getPendingOwnerApprovals(
  testMode: boolean,
): Promise<SpecOwnerApprovalQueueRow[]> {
  const query = db()
    .from("spec_owner_approval_requests")
    .select(
      "id, spec_project_id, buyer_user_id, account_holder_user_id, linked_company_id, tier, approved_total_cents, approved_deposit_cents, requested_at, status, is_test",
    )
    .eq("status", "pending")
    .order("requested_at", { ascending: true });
  const { data, error } = (await applyTestModeFilter(
    query as unknown as Filterable,
    testMode,
  )) as unknown as {
    data: OwnerApprovalRowRaw[] | null;
    error: { message: string } | null;
  };
  if (error) {
    console.error("[getPendingOwnerApprovals] failed:", error.message);
    return [];
  }
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const userIds = Array.from(
    new Set(rows.flatMap((r) => [r.buyer_user_id, r.account_holder_user_id])),
  );
  const companyIds = Array.from(new Set(rows.map((r) => r.linked_company_id)));

  const [users, companies] = await Promise.all([
    loadOwnerApprovalUsers(userIds),
    loadOwnerApprovalCompanies(companyIds),
  ]);

  return rows.map((r) => {
    const ageInfo = ageLabelFromIso(r.requested_at);
    const buyer = users.get(r.buyer_user_id);
    const accountHolder = users.get(r.account_holder_user_id);
    const company = companies.get(r.linked_company_id);
    return {
      id: r.id,
      specProjectId: r.spec_project_id,
      status: r.status,
      tier: ofTier(r.tier),
      approvedTotalCents: r.approved_total_cents,
      approvedDepositCents: r.approved_deposit_cents,
      requestedAt: r.requested_at,
      ageLabel: ageInfo.ageLabel,
      ageMinutes: ageInfo.ageMinutes,
      isTest: r.is_test,
      buyerUserId: r.buyer_user_id,
      buyerName: buyer?.name ?? null,
      buyerEmail: buyer?.email ?? null,
      accountHolderUserId: r.account_holder_user_id,
      accountHolderName: accountHolder?.name ?? null,
      accountHolderEmail: accountHolder?.email ?? null,
      companyId: r.linked_company_id,
      companyName: company ?? null,
    };
  });
}

async function loadOwnerApprovalUsers(
  userIds: string[],
): Promise<Map<string, { name: string | null; email: string | null }>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await db()
    .from("users")
    .select("id, email, name")
    .in("id", userIds);
  if (error) {
    console.error("[loadOwnerApprovalUsers] failed:", error.message);
    return new Map();
  }
  return new Map(
    (data ?? []).map((r) => [
      r.id as string,
      {
        name: (r.name as string | null) ?? null,
        email: (r.email as string | null) ?? null,
      },
    ]),
  );
}

async function loadOwnerApprovalCompanies(
  companyIds: string[],
): Promise<Map<string, string | null>> {
  if (companyIds.length === 0) return new Map();
  const { data, error } = await db()
    .from("companies")
    .select("id, name")
    .in("id", companyIds);
  if (error) {
    console.error("[loadOwnerApprovalCompanies] failed:", error.message);
    return new Map();
  }
  return new Map(
    (data ?? []).map((r) => [r.id as string, (r.name as string | null) ?? null]),
  );
}
