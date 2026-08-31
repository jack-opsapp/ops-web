import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const FIRST_VALUE_WINDOW_DAYS = 14 as const;

export interface GrowthMilestoneDailyRow {
  reporting_date: string;
  trials_started: number;
  classified_trials: number;
  first_project_companies: number;
  activated_companies: number;
  paid_companies: number;
  first_value_companies: number;
  revenue_cents: number;
}

export interface GrowthMilestoneSummary {
  trialsStarted: number;
  classifiedTrials: number;
  firstProjectCompanies: number;
  activatedCompanies: number;
  firstValueCompanies: number;
  paidCompanies: number;
  revenueCents: number;
}

export interface GrowthMilestonePeriod {
  startDate: string;
  endDate: string;
  days: number;
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Growth milestone date must use YYYY-MM-DD");
  }
  const date = new Date(`${value}T12:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== value) {
    throw new Error("Growth milestone date was invalid");
  }
  return date;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

export function growthMilestoneComparisonPeriods(input: {
  startDate: string;
  endDate: string;
}): { current: GrowthMilestonePeriod; previous: GrowthMilestonePeriod } {
  const start = parseDate(input.startDate);
  const end = parseDate(input.endDate);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days < 1 || days > 366) {
    throw new Error("Growth milestone period must contain 1 to 366 days");
  }
  const previousEnd = addDays(input.startDate, -1);
  return {
    current: { ...input, days },
    previous: {
      startDate: addDays(previousEnd, -(days - 1)),
      endDate: previousEnd,
      days,
    },
  };
}

function nonNegativeInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Growth milestone ${field} was invalid`);
  }
  return parsed;
}

export function summarizeGrowthMilestones(
  rows: Array<Record<string, unknown>>
): GrowthMilestoneSummary {
  const summary: GrowthMilestoneSummary = {
    trialsStarted: 0,
    classifiedTrials: 0,
    firstProjectCompanies: 0,
    activatedCompanies: 0,
    firstValueCompanies: 0,
    paidCompanies: 0,
    revenueCents: 0,
  };
  for (const row of rows) {
    summary.trialsStarted += nonNegativeInteger(
      row.trials_started,
      "trials_started"
    );
    summary.classifiedTrials += nonNegativeInteger(
      row.classified_trials,
      "classified_trials"
    );
    summary.firstProjectCompanies += nonNegativeInteger(
      row.first_project_companies,
      "first_project_companies"
    );
    summary.activatedCompanies += nonNegativeInteger(
      row.activated_companies,
      "activated_companies"
    );
    summary.firstValueCompanies += nonNegativeInteger(
      row.first_value_companies,
      "first_value_companies"
    );
    summary.paidCompanies += nonNegativeInteger(
      row.paid_companies,
      "paid_companies"
    );
    summary.revenueCents += nonNegativeInteger(
      row.revenue_cents,
      "revenue_cents"
    );
  }
  return summary;
}

export async function getGrowthMilestoneComparison(
  input: { startDate: string; endDate: string },
  client: SupabaseClient = getAdminSupabase()
): Promise<{
  current: GrowthMilestonePeriod & { metrics: GrowthMilestoneSummary };
  previous: GrowthMilestonePeriod & { metrics: GrowthMilestoneSummary };
}> {
  const periods = growthMilestoneComparisonPeriods(input);
  const { data, error } = await client
    .from("growth_funnel_daily")
    .select(
      "reporting_date, trials_started, classified_trials, first_project_companies, activated_companies, first_value_companies, paid_companies, revenue_cents"
    )
    .gte("reporting_date", periods.previous.startDate)
    .lte("reporting_date", periods.current.endDate)
    .order("reporting_date", { ascending: true });
  if (error) {
    throw new Error(`Growth milestone query failed: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const currentRows = rows.filter((row) => {
    const date = String(row.reporting_date ?? "");
    return date >= periods.current.startDate && date <= periods.current.endDate;
  });
  const previousRows = rows.filter((row) => {
    const date = String(row.reporting_date ?? "");
    return date >= periods.previous.startDate && date <= periods.previous.endDate;
  });
  return {
    current: {
      ...periods.current,
      metrics: summarizeGrowthMilestones(currentRows),
    },
    previous: {
      ...periods.previous,
      metrics: summarizeGrowthMilestones(previousRows),
    },
  };
}
