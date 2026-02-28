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

// ─── Subscription Derivation ──────────────────────────────────────────────

/** Derive subscription status from available fields when subscription_status is null */
export function deriveSubscriptionStatus(company: {
  subscription_status?: string | null;
  trial_end_date?: string | null;
  stripe_customer_id?: string | null;
}): string {
  if (company.subscription_status) return company.subscription_status;
  if (company.trial_end_date) {
    return new Date(company.trial_end_date) > new Date() ? "trial" : "expired";
  }
  return "no subscription";
}

/** Derive subscription plan from available fields when subscription_plan is null */
export function deriveSubscriptionPlan(company: {
  subscription_plan?: string | null;
  subscription_status?: string | null;
  trial_end_date?: string | null;
  stripe_customer_id?: string | null;
}): string {
  if (company.subscription_plan) return company.subscription_plan;
  const status = deriveSubscriptionStatus(company);
  if (status === "trial" || status === "expired") return "trial";
  return "—";
}

// ─── Date Range / Granularity Types ──────────────────────────────────────────

export type Granularity = "hourly" | "daily" | "weekly" | "monthly";

export type DatePreset = "today" | "7d" | "30d" | "90d" | "12m" | "all";

export interface DateRangeParams {
  from: string;
  to: string;
  granularity: Granularity;
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

// ─── Blog Types ──────────────────────────────────────────────────────────────

export interface BlogCategory {
  id: string;
  name: string;
  slug: string;
}

export interface BlogTopic {
  id: string;
  topic: string;
  author: string;
  image_url: string | null;
  used: boolean;
  created_at: string;
  updated_at: string;
}

export interface BlogPost {
  id: string;
  title: string;
  subtitle: string | null;
  slug: string;
  author: string | null;
  content: string;
  summary: string | null;
  teaser: string | null;
  meta_title: string | null;
  thumbnail_url: string | null;
  category_id: string | null;
  category2_id: string | null;
  is_live: boolean;
  display_views: number;
  word_count: number;
  faqs: { question: string; answer: string }[];
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogPostListItem extends BlogPost {
  category_name: string | null;
  category2_name: string | null;
  ga4_views?: number;
}

// ─── OPS Learn Types ─────────────────────────────────────────────────────────

export interface LearnCourseOverview {
  id: string;
  title: string;
  slug: string;
  status: string;
  price_cents: number;
  sort_order: number;
  module_count: number;
  lesson_count: number;
  assessment_count: number;
  enrolled_count: number;
  completed_count: number;
  display_enrollments: number;
  display_rating: number;
  display_review_count: number;
}

export interface LearnContentBlock {
  type: string;
}

export interface LearnLessonDetail {
  id: string;
  title: string;
  slug: string;
  duration_minutes: number | null;
  sort_order: number;
  content_blocks: LearnContentBlock[];
}

export interface LearnAssessmentDetail {
  id: string;
  title: string;
  slug: string;
  type: "quiz" | "assignment" | "test";
  sort_order: number;
  passing_score: number | null;
  question_count: number;
}

export interface LearnModuleDetail {
  id: string;
  title: string;
  sort_order: number;
  lessons: LearnLessonDetail[];
  assessments: LearnAssessmentDetail[];
}

export interface LearnCourseDetail {
  id: string;
  title: string;
  slug: string;
  status: string;
  price_cents: number;
  display_enrollments: number;
  display_rating: number;
  display_review_count: number;
  modules: LearnModuleDetail[];
}

export interface LearnEnrollmentCounts {
  total: number;
  active: number;
  completed: number;
  completion_rate: number;
}

export interface LearnLessonProgress {
  lesson_id: string;
  lesson_title: string;
  module_title: string;
  module_sort_order: number;
  lesson_sort_order: number;
  started_count: number;
  completed_count: number;
}

export interface LearnAssessmentStats {
  assessment_id: string;
  assessment_title: string;
  type: string;
  submission_count: number;
  pass_count: number;
  pass_rate: number;
  avg_score: number;
}

export interface LearnCourseAnalytics {
  enrollment: LearnEnrollmentCounts;
  lesson_progress: LearnLessonProgress[];
  assessment_stats: LearnAssessmentStats[];
}

export interface LearnVanityMetrics {
  display_enrollments: number;
  display_rating: number;
  display_review_count: number;
}

// ─── Analytics Types ─────────────────────────────────────────────────────────

export interface WebsiteOverview {
  sessions: number;
  activeUsers: number;
  pageviews: number;
  newUsers: number;
  avgSessionDuration: number; // seconds
  bounceRate: number; // 0–1
}

export interface AnalyticsPageData {
  overview: WebsiteOverview;
  sessionsByDate: ChartDataPoint[];
  topPages: { dimension: string; count: number }[];
  topReferrers: { dimension: string; count: number }[];
  deviceBreakdown: { dimension: string; count: number }[];
}

// ─── Email Types ──────────────────────────────────────────────────────────────

export interface EmailLogRow {
  id: string;
  user_id: string | null;
  email_type: string;
  recipient_email: string;
  subject: string;
  sent_at: string;
  status: string;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
}

export interface EmailOverviewStats {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  deliveryRate: number;
  dailyVolume: ChartDataPoint[];
}

export interface EmailFunnelStage {
  step: string;
  count: number;
}

export interface EmailFunnelData {
  bubble: EmailFunnelStage[];
  unverified: EmailFunnelStage[];
  auth: EmailFunnelStage[];
  segmentCounts: {
    total_users: number;
    bubble_reauth: number;
    unverified: number;
    auth_lifecycle: number;
    removed: number;
  };
}

export interface EmailEngagementStats {
  totalDelivered: number;
  uniqueOpens: number;
  uniqueClicks: number;
  totalBounces: number;
  spamReports: number;
  openRate: number;
  clickRate: number;
}

export interface EmailScheduleDay {
  date: string;                    // YYYY-MM-DD
  counts: Record<string, number>;  // email_type_prefix → count
  total: number;
}

export interface EmailDayDetail {
  recipient_email: string;
  email_type: string;
  subject: string;
  status: string;
  sent_at: string;
}

export interface NewsletterContent {
  id: string;
  month: number;
  year: number;
  shipped: string[];
  in_progress: string[];
  bug_fixes: string[];
  coming_up: string[];
  custom_intro: string | null;
  custom_outro: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}
