/**
 * Briefing Step 3: Scan market sentiment.
 * Uses Tavily to search Reddit, forums, and X for trade worker opinions.
 */
import { tavily } from "@tavily/core";

const SENTIMENT_QUERIES = [
  'site:reddit.com "field service software" OR "scheduling app" electrician plumber HVAC contractor',
  'site:reddit.com r/smallbusiness contractor software complaints OR recommendations 2026',
  '"field service management" software frustrating OR "switched to" OR "love using"',
  'trade contractor app scheduling invoicing pain points 2026',
];

function getTavilyClient() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("Missing TAVILY_API_KEY env var");
  return tavily({ apiKey });
}

/** Get raw market sentiment content for Step 4's AI prompt. */
export async function getMarketSentimentContent(): Promise<string> {
  const client = getTavilyClient();
  const results = await Promise.all(
    SENTIMENT_QUERIES.map((query) =>
      client.search(query, { maxResults: 5, searchDepth: "advanced", includeAnswer: true })
        .catch(() => ({ results: [], answer: "" }))
    )
  );

  const parts: string[] = [];
  for (const result of results) {
    if (result.answer) parts.push(`SUMMARY: ${result.answer}`);
    for (const item of result.results) {
      parts.push(`SOURCE: ${item.title}\nURL: ${item.url}\n${item.content}`);
    }
  }
  return parts.join("\n\n---\n\n");
}
