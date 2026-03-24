/**
 * Briefing Step 4: AI Analysis + Generation.
 * Feeds Steps 1-3 data to OpenAI gpt-4o with structured output.
 */
import OpenAI from "openai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { briefingOutputSchema, type BriefingOutput, type PerformanceSnapshot } from "../briefing-types";

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");
  _client = new OpenAI({ apiKey });
  return _client;
}

const SYSTEM_PROMPT = `You are an expert PPC analyst and ad strategist for OPS, a field service management platform for trade workers (electricians, plumbers, HVAC technicians, contractors, roofers).

OPS helps trade businesses manage jobs, scheduling, invoicing, and crew coordination. Key differentiators:
- Built specifically for trade crews (not generic project management)
- No contracts, no setup fees
- Mobile-first for field use
- Simple pricing ($90-190/month)

Your job is to analyze Google Ads performance data, competitor intelligence, and market sentiment to produce an actionable weekly briefing. Be specific, quantitative, and direct. Every recommendation must be implementable.`;

export async function generateBriefingAnalysis(
  performanceData: PerformanceSnapshot,
  competitorContent: string,
  sentimentContent: string,
  isFirstBriefing: boolean
): Promise<BriefingOutput> {
  const client = getClient();
  const jsonSchema = zodToJsonSchema(briefingOutputSchema, "BriefingOutput");

  const userPrompt = `Analyze the following data and generate a comprehensive Google Ads intelligence briefing.

## PERFORMANCE DATA (Last 7 Days)
Spend: $${performanceData.current.spend.toFixed(2)} (${isFirstBriefing ? "first briefing, no comparison" : `${(performanceData.deltas.spend * 100).toFixed(1)}% vs prior week`})
CPA: $${performanceData.current.cpa.toFixed(2)} (${isFirstBriefing ? "no comparison" : `${(performanceData.deltas.cpa * 100).toFixed(1)}%`})
CTR: ${(performanceData.current.ctr * 100).toFixed(2)}% (${isFirstBriefing ? "no comparison" : `${(performanceData.deltas.ctr * 100).toFixed(1)}%`})
Clicks: ${performanceData.current.clicks} | Impressions: ${performanceData.current.impressions} | Conversions: ${performanceData.current.conversions}
Top Campaign: ${performanceData.topCampaign.name} (${performanceData.topCampaign.conversions} conv, $${performanceData.topCampaign.cpa.toFixed(2)} CPA)
Worst Campaign: ${performanceData.worstCampaign.name} ($${performanceData.worstCampaign.spend.toFixed(2)} spend, ${performanceData.worstCampaign.conversions} conv, $${performanceData.worstCampaign.cpa.toFixed(2)} CPA)

## COMPETITOR INTELLIGENCE
${competitorContent || "No competitor data available this week."}

## MARKET SENTIMENT (Reddit, Forums, X)
${sentimentContent || "No sentiment data available this week."}

## INSTRUCTIONS
Generate:
1. Executive summary (2-3 sentences, lead with the most impactful finding)
2. 5-8 insights scored 1-10 by impact
3. 5 headline suggestions (max 30 chars each) + 3 description suggestions (max 90 chars each)
4. Keyword recommendations (add + negative)
5. 2-3 A/B test proposals comparing realistic current ads vs proposed variants with hypothesis
6. Ranked action items with effort estimates
7. Structured competitor intel: for each competitor found (Jobber, ServiceTitan, Housecall Pro, etc.), extract their ad copy, offers, landing page angle, and weaknesses OPS can exploit
8. Structured market sentiment: extract 3-5 themes from the Reddit/forum data with sentiment, source attribution, direct quotes, and messaging opportunities

Be specific. Use actual numbers from the data. Reference specific competitors and sentiment quotes where relevant.`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "BriefingOutput",
        schema: jsonSchema as Record<string, unknown>,
        strict: true,
      },
    },
    temperature: 0.7,
    max_tokens: 4096,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty response");

  const parsed = JSON.parse(content);
  return briefingOutputSchema.parse(parsed);
}
