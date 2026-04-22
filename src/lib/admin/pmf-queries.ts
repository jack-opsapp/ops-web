import 'server-only';
import { unstable_cache } from 'next/cache';
import { getAdminSupabase } from '@/lib/supabase/admin-client';
import {
  statusForMarker1, statusForMarker2, statusForMarker3, statusForMarker4,
  statusForIndicatorA, statusForIndicatorB, statusForIndicatorC, statusForIndicatorD,
} from '@/lib/pmf/marker-compute';
import type { PmfState, MarkerStatus } from '@/lib/pmf/types';

const TTL = 60;

// Marker 1 — Tier A paid & delivered
async function queryMarker1(): Promise<number> {
  const sb = getAdminSupabase();
  const { data, error } = await sb.rpc('pmf_count_tier_a_paid_delivered' as never);
  if (error) throw error;
  if (typeof data === 'number') return data;
  // fallback inline query
  const { data: rows, error: e2 } = await sb
    .from('pmf_deals')
    .select('id, deposit_amount_cents, implementation_fee_cents, stage, deposit_paid_at')
    .eq('deal_type','tier_a')
    .in('stage', ['in_delivery','delivered','closed_won'])
    .not('deposit_paid_at','is',null);
  if (e2) throw e2;
  return (rows ?? []).filter(
    r => (r.deposit_amount_cents ?? 0) >= (r.implementation_fee_cents ?? 0) * 0.5
  ).length;
}

// Marker 2 — retained base SaaS (60-day consecutive + still active)
async function queryMarker2(): Promise<number> {
  const sb = getAdminSupabase();
  const { data, error } = await sb.rpc('pmf_count_retained_saas' as never);
  if (error || typeof data !== 'number') {
    throw new Error(`queryMarker2: ${error?.message ?? 'rpc missing — add function in migration'}`);
  }
  return data;
}

// Marker 3 — inbound leads
async function queryMarker3(): Promise<number> {
  const sb = getAdminSupabase();
  const { count, error } = await sb
    .from('pmf_prospects')
    .select('*', { count: 'exact', head: true })
    .or('first_contact_direction.eq.inbound,source.in.(paid_ad,organic_search,referral,direct)');
  if (error) throw error;
  return count ?? 0;
}

// Marker 4 — cumulative spend + attributed paid
async function queryMarker4(): Promise<{ spendUsd: number; attributedPaid: number }> {
  const sb = getAdminSupabase();
  const [{ data: spendRows, error: spendErr }, { count: paidCount, error: paidErr }] = await Promise.all([
    sb.from('ad_spend_log').select('spend_cents'),
    sb.from('trial_attributions').select('*', { count: 'exact', head: true }).not('first_paid_at','is',null),
  ]);
  if (spendErr) throw spendErr;
  if (paidErr) throw paidErr;
  const totalCents = (spendRows ?? []).reduce((a, r) => a + (r.spend_cents ?? 0), 0);
  return { spendUsd: totalCents / 100, attributedPaid: paidCount ?? 0 };
}

// Indicator A — active Tier A pipeline
async function queryIndicatorA(): Promise<number> {
  const sb = getAdminSupabase();
  const { count, error } = await sb.from('pmf_deals')
    .select('*', { count: 'exact', head: true })
    .eq('deal_type','tier_a')
    .in('stage', ['contacted','qualified','proposal','negotiation']);
  if (error) throw error;
  return count ?? 0;
}

// Indicator B — weekly new trials (last 7 days)
async function queryIndicatorB(): Promise<number> {
  const sb = getAdminSupabase();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { count, error } = await sb.from('trial_attributions')
    .select('*', { count: 'exact', head: true })
    .gte('trial_started_at', since);
  if (error) throw error;
  return count ?? 0;
}

// Indicator C — most mature trial→paid cohort conversion rate
async function queryIndicatorC(): Promise<number> {
  const sb = getAdminSupabase();
  // Use RPC for cohort math
  const { data, error } = await sb.rpc('pmf_latest_mature_conversion' as never);
  if (error || typeof data !== 'number') return 0;
  return data;
}

// Indicator D — monthly cohort churn (latest mature)
async function queryIndicatorD(): Promise<number> {
  const sb = getAdminSupabase();
  const { data, error } = await sb.rpc('pmf_latest_cohort_churn' as never);
  if (error || typeof data !== 'number') return 0;
  return data;
}

// Indicator E — referral count
async function queryIndicatorE(): Promise<number> {
  const sb = getAdminSupabase();
  const { count, error } = await sb.from('pmf_prospects')
    .select('*', { count: 'exact', head: true })
    .eq('source','referral');
  if (error) throw error;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Sparklines (12 weeks)
// ---------------------------------------------------------------------------
async function querySparkline(kind: 'trials'|'active_pipeline'|'churn'|'conversion'|'referrals'): Promise<number[]> {
  const sb = getAdminSupabase();
  const { data, error } = await sb.rpc('pmf_sparkline' as never, { kind });
  if (error) return new Array(12).fill(0);
  return (data as number[]) ?? new Array(12).fill(0);
}

// ---------------------------------------------------------------------------
// Top-level: computePmfState
// ---------------------------------------------------------------------------
export async function computePmfState(): Promise<PmfState> {
  const [m1, m2, m3, m4, a, b, c, d, e, sparkB, sparkA, sparkC, sparkD, sparkE] = await Promise.all([
    queryMarker1(), queryMarker2(), queryMarker3(), queryMarker4(),
    queryIndicatorA(), queryIndicatorB(), queryIndicatorC(), queryIndicatorD(), queryIndicatorE(),
    querySparkline('trials'), querySparkline('active_pipeline'),
    querySparkline('conversion'), querySparkline('churn'), querySparkline('referrals'),
  ]);

  return {
    capturedAt: new Date().toISOString(),
    markers: {
      marker_1: { status: statusForMarker1(m1), value: m1, target: 2, label: 'TIER A ENGAGEMENTS' },
      marker_2: { status: statusForMarker2(m2), value: m2, target: 5, label: 'RETAINED BASE SAAS' },
      marker_3: { status: statusForMarker3(m3), value: m3, target: 1, label: 'INBOUND LEAD' },
      marker_4: {
        status: statusForMarker4(m4),
        value: Math.round(m4.spendUsd),
        target: 15000,
        label: 'CAC FROM $15K SPEND',
        detail: `${m4.attributedPaid} paid attributed`,
      },
    },
    indicators: {
      indicator_a: { status: statusForIndicatorA(a), value: a, delta_wow: wow(sparkA), sparkline: sparkA, label: 'ACTIVE TIER A' },
      indicator_b: { status: statusForIndicatorB(b), value: b, delta_wow: wow(sparkB), sparkline: sparkB, label: 'WEEKLY TRIALS' },
      indicator_c: { status: statusForIndicatorC(c), value: c, delta_wow: wow(sparkC), sparkline: sparkC, label: 'TRIAL→PAID', unit: 'percent' },
      indicator_d: { status: statusForIndicatorD(d), value: d, delta_wow: wow(sparkD), sparkline: sparkD, label: 'COHORT CHURN', unit: 'percent' },
      indicator_e: { status: (e > 0 ? 'green' : 'red') as MarkerStatus, value: e, delta_wow: wow(sparkE), sparkline: sparkE, label: 'REFERRALS' },
    },
  };
}

function wow(sparkline: number[]): number {
  if (sparkline.length < 2) return 0;
  const curr = sparkline[sparkline.length - 1];
  const prev = sparkline[sparkline.length - 2];
  return curr - prev;
}

export const getPmfState = unstable_cache(
  computePmfState,
  ['pmf-state'],
  { revalidate: TTL, tags: ['pmf-state'] }
);
