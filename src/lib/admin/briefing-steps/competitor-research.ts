/**
 * Briefing Step 2: Research competitor Google Ads.
 * Uses Tavily web search to find competitor ad copy, offers, and messaging.
 */
import { tavily } from "@tavily/core";

const SEARCH_QUERIES = [
  '"field service management software" Google Ads competitor ads 2026',
  "Jobber vs ServiceTitan vs Housecall Pro ads pricing offers",
  '"contractor scheduling app" Google Ads headlines descriptions',
  "field service software landing page value proposition comparison",
];

function getTavilyClient() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("Missing TAVILY_API_KEY env var");
  return tavily({ apiKey });
}

/** Get raw competitor search content for Step 4's AI prompt. */
export async function getCompetitorSearchContent(): Promise<string> {
  const client = getTavilyClient();
  const results = await Promise.all(
    SEARCH_QUERIES.map((query) =>
      client.search(query, { maxResults: 5, searchDepth: "advanced", includeAnswer: true })
        .catch(() => ({ results: [], answer: "" }))
    )
  );

  const parts: string[] = [];
  for (const result of results) {
    if (result.answer) parts.push(`SUMMARY: ${result.answer}`);
    for (const item of result.results) {
      parts.push(`SOURCE: ${item.title}\n${item.content}`);
    }
  }
  return parts.join("\n\n---\n\n");
}
