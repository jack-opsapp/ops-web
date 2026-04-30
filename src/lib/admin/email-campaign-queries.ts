import { getServiceRoleClient } from "@/lib/supabase/server-client";
import type {
  CampaignEngagementStats,
  CampaignFunnelStage,
  VersionCompareResult,
} from "./email-campaign-types";

export async function getCampaignEngagementStats(
  campaignId: string
): Promise<CampaignEngagementStats | null> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.rpc("campaign_engagement_stats", {
    p_campaign_id: campaignId,
  });
  if (error) {
    console.error("[getCampaignEngagementStats]", error);
    return null;
  }
  return (data ?? null) as unknown as CampaignEngagementStats | null;
}

export async function getCampaignFunnelStages(
  campaignId: string
): Promise<CampaignFunnelStage[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.rpc("campaign_funnel_stages", {
    p_campaign_id: campaignId,
  });
  if (error) {
    console.error("[getCampaignFunnelStages]", error);
    return [];
  }
  return ((data ?? []) as Array<{ stage: string; value: number | string | null }>).map((r) => ({
    stage: r.stage as CampaignFunnelStage["stage"],
    value: Number(r.value ?? 0),
  }));
}

export async function getTemplateVersionCompare(
  emailType: string,
  versionA: string,
  versionB: string,
  sinceIso?: string
): Promise<VersionCompareResult | null> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.rpc("template_version_compare", {
    p_email_type: emailType,
    p_version_a: versionA,
    p_version_b: versionB,
    p_since:
      sinceIso ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) {
    console.error("[getTemplateVersionCompare]", error);
    return null;
  }
  return data as unknown as VersionCompareResult;
}
