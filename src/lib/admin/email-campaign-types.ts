export interface CampaignFunnelStage {
  stage: "enqueued" | "dispatched" | "delivered" | "opened" | "clicked";
  value: number;
}

export interface PerDomainBounce {
  domain: string;
  bounces: number;
  delivered: number;
  dropped: number;
}

export interface CampaignEngagementStats {
  campaign_id: string;
  sent: number;
  delivered: number;
  bounced: number;
  opened: number;
  clicked: number;
  spam_reports: number;
  unsubscribes: number;
  suppressed_skipped: number;
  failed: number;
  in_flight: number;
  open_rate: number;
  click_rate: number;
  bounce_rate: number;
  ctor: number;
  per_domain_bounce_summary: PerDomainBounce[];
  first_event_at: string | null;
  last_event_at: string | null;
}

export interface VersionMetrics {
  sent: number;
  opens: number;
  clicks: number;
  bounces: number;
  open_rate: number;
  click_rate: number;
  bounce_rate: number;
}

export interface VersionCompareResult {
  email_type: string;
  since: string;
  versions: Record<string, VersionMetrics>;
}
