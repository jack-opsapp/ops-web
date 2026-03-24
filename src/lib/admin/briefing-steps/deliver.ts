/**
 * Briefing Step 5: Store results + send email.
 */
import { completeBriefing, markEmailSent } from "../briefing-queries";
import { getAdminEmails } from "../admin-queries";
import { sendAdsBriefing } from "@/lib/email/sendgrid";
import { getBriefingById } from "../briefing-queries";
import type {
  PerformanceSnapshot,
  CompetitorSnapshot,
  SentimentTheme,
  BriefingOutput,
} from "../briefing-types";

export async function deliverBriefing(
  briefingId: string,
  performanceData: PerformanceSnapshot,
  competitorIntel: CompetitorSnapshot[],
  marketSentiment: SentimentTheme[],
  aiOutput: BriefingOutput
): Promise<void> {
  // Store in Supabase
  await completeBriefing(briefingId, {
    summary: aiOutput.summary,
    performance_data: performanceData,
    competitor_intel: competitorIntel,
    market_sentiment: marketSentiment,
    insights: aiOutput.insights,
    ad_suggestions: aiOutput.adSuggestions,
    keyword_recs: aiOutput.keywordRecs,
    ab_test_proposals: aiOutput.abTestProposals,
    action_items: aiOutput.actionItems,
  });

  // Send email
  try {
    const adminEmails = await getAdminEmails();
    if (adminEmails.length > 0) {
      const briefing = await getBriefingById(briefingId);
      if (briefing) {
        await sendAdsBriefing({ recipientEmails: adminEmails, briefing });
        await markEmailSent(briefingId);
      }
    }
  } catch (err) {
    // Email failure should not fail the briefing
    console.error("[ads-briefing] Email delivery failed:", err);
  }
}
