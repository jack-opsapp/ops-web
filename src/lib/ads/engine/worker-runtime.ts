import "server-only";
import { isGoogleAdsConfigured, queryCampaignBudgetPacing } from "@/lib/analytics/google-ads-client";
import { applyProposal, type ApplyProposalRecord } from "./apply";
import { createGoogleGateway, googleGatewayAvailable } from "./google-gateway";
import { getAdsOperator } from "./operator";
import { createEngineRepository } from "./repository";
import { runEngineTick } from "./worker";

export function isRehearsal(env: Record<string, string | undefined> = process.env): boolean {
  return env.ADS_ENGINE_REHEARSAL === "1";
}

/** Composition root for the daily cron tick. */
export async function runAdsEngineTick() {
  const repository = createEngineRepository();
  const now = () => new Date();
  const gateway = googleGatewayAvailable() ? createGoogleGateway() : null;
  const rehearsal = isRehearsal();
  const result = await runEngineTick({
    repository,
    now,
    operator: getAdsOperator(process.env),
    apply: gateway
      ? (proposal: ApplyProposalRecord) => applyProposal(proposal, { gateway, repository, now, rehearsal, appliedBy: "auto" })
      : null,
    gateway,
    readBudgetPacing: isGoogleAdsConfigured()
      ? async (window) =>
          (await queryCampaignBudgetPacing(new Date(`${window.from}T00:00:00.000Z`), new Date(`${window.to}T00:00:00.000Z`))).map((row) => ({
            date: row.date,
            campaignId: row.campaignId,
            campaignName: row.campaignName,
            lostShare: row.lostShare,
          }))
      : null,
  });
  return { ...result, rehearsal, google: gateway ? "available" : "unavailable" };
}
