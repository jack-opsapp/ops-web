/**
 * OPS Admin Panel — TypeScript Types
 */

// ─── KPI / Stat Types ─────────────────────────────────────────────────────────

export interface KpiCard {
  label: string;
  value: string | number;
  caption?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  accent?: boolean;
  danger?: boolean;
}

export interface SparklineData {
  label: string;
  value: number;
}

export interface AlertItem {
  severity: "info" | "warning" | "danger";
  title: string;
  detail?: string;
  href?: string;
}

// ─── Company Types ────────────────────────────────────────────────────────────

export interface CompanyRow {
  id: string;
  name: string;
  subscription_plan: string | null;
  subscription_status: string | null;
  subscription_end: string | null;
  trial_start_date: string | null;
  trial_end_date: string | null;
  created_at: string;
  seated_employee_ids: string[] | null;
  max_seats: number | null;
  stripe_customer_id: string | null;
  has_priority_support: boolean | null;
  data_setup_completed: boolean | null;
  data_setup_purchased: boolean | null;
}

export interface CompanyListItem extends CompanyRow {
  userCount: number;
  projectCount: number;
  pipelineCount: number;
  lastActive: string | null;
}

// ─── Revenue Types ────────────────────────────────────────────────────────────

export const PLAN_PRICES: Record<string, number> = {
  starter: 90,
  team: 140,
  business: 190,
};

export interface PlanDistribution {
  plan: string;
  count: number;
  mrr: number;
  avgUsers: number;
  avgProjects: number;
  color: string;
}

export interface SeatUtilization {
  companyId: string;
  companyName: string;
  plan: string;
  seatsUsed: number;
  maxSeats: number;
  utilization: number;
}

// ─── Engagement Types ─────────────────────────────────────────────────────────

export interface FeatureAdoption {
  feature: string;
  table: string;
  totalCount: number;
  companiesUsing: number;
  adoptionRate: number;
}

export interface CohortRow {
  cohort: string;
  signups: number;
  month1: number;
  month2: number;
  month3: number;
  month6: number;
  month12: number;
}

// ─── Platform Health Types ────────────────────────────────────────────────────

export interface PipelineStage {
  stage: string;
  count: number;
  totalValue: number;
  avgDays: number;
}

export interface InvoiceAging {
  bucket: string;
  count: number;
  totalAmount: number;
}

// ─── Feedback Types ───────────────────────────────────────────────────────────

export interface FeatureRequest {
  id: string;
  type: string;
  title: string;
  description: string | null;
  platform: string | null;
  status: string;
  user_email: string | null;
  created_at: string;
}

export interface AppMessage {
  id: string;
  title: string;
  body: string | null;
  active: boolean;
  created_at: string;
}

export interface PromoCode {
  id: string;
  code: string;
  discount_percent: number | null;
  discount_amount: number | null;
  usage_count: number;
  max_uses: number | null;
  active: boolean;
  created_at: string;
}

// ─── System Types ─────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
}

export interface DataQualityIssue {
  check: string;
  severity: "info" | "warning" | "danger";
  count: number;
  detail?: string;
}

export interface TableStats {
  table: string;
  rowCount: number;
}

// ─── Chart Types ──────────────────────────────────────────────────────────────

export interface ChartDataPoint {
  label: string;
  value: number;
}

export interface StackedBarDataPoint {
  label: string;
  added: number;
  churned: number;
}

export interface DonutSegment {
  name: string;
  value: number;
  color: string;
}
