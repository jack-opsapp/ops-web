/**
 * OPS Admin — Google Ads Intelligence Briefing Agent
 *
 * 5-step pipeline:
 * 1. Pull Google Ads performance data
 * 2. Research competitor ads (Tavily)
 * 3. Scan market sentiment (Tavily)
 * 4. AI analysis + generation (OpenAI)
 * 5. Store in Supabase + send email
 */
import {
  createBriefing,
  getActiveBriefing,
  updateBriefingProgress,
  failBriefing,
  getLatestBriefing,
} from "./briefing-queries";
import { pullAdsData } from "./briefing-steps/pull-ads-data";
import { getCompetitorSearchContent } from "./briefing-steps/competitor-research";
import { getMarketSentimentContent } from "./briefing-steps/market-sentiment";
import { generateBriefingAnalysis } from "./briefing-steps/ai-analysis";
import { deliverBriefing } from "./briefing-steps/deliver";
import type { BriefingProgress } from "./briefing-types";

async function updateProgress(
  briefingId: string,
  step: number,
  label: string,
  completedSteps: string[]
): Promise<void> {
  const progress: BriefingProgress = { step, total: 5, label, completedSteps };
  await updateBriefingProgress(briefingId, progress);
}

/**
 * Run the full briefing pipeline. Returns the briefing ID.
 * If a briefing is already generating, returns that ID (idempotency).
 */
export async function generateBriefing(
  triggeredBy: "cron" | "manual"
): Promise<string> {
  // Idempotency guard
  const active = await getActiveBriefing();
  if (active) return active;

  const briefingId = await createBriefing(triggeredBy);
  const completed: string[] = [];

  try {
    // Step 1: Pull ads data
    await updateProgress(briefingId, 1, "Pulling ad performance data...", completed);
    const performanceData = await pullAdsData();
    completed.push("Ad performance data pulled");

    // Step 2: Competitor research
    await updateProgress(briefingId, 2, "Researching competitor ads...", completed);
    const competitorContent = await getCompetitorSearchContent();
    completed.push("Competitor research complete");

    // Step 3: Market sentiment
    await updateProgress(briefingId, 3, "Scanning market sentiment...", completed);
    const sentimentContent = await getMarketSentimentContent();
    completed.push("Market sentiment scanned");

    // Step 4: AI analysis
    await updateProgress(briefingId, 4, "Generating insights and recommendations...", completed);
    const isFirstBriefing = (await getLatestBriefing()) === null;
    const aiOutput = await generateBriefingAnalysis(
      performanceData,
      competitorContent,
      sentimentContent,
      isFirstBriefing
    );
    completed.push("AI analysis complete");

    // Step 5: Store + email
    await updateProgress(briefingId, 5, "Delivering briefing...", completed);
    await deliverBriefing(
      briefingId,
      performanceData,
      aiOutput.competitorIntel,
      aiOutput.marketSentiment,
      aiOutput
    );
    completed.push("Briefing delivered");

    return briefingId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failBriefing(briefingId, message);
    throw err;
  }
}
