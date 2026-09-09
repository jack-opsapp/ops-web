import "server-only";
import { BRAND_FACTS } from "../copy-rules";
import { loadOpsCopywriterBrief } from "@/lib/social/editorial/copywriting-reference";
import { getCompetitorSearchContent } from "@/lib/admin/briefing-steps/competitor-research";
import { getMarketSentimentContent } from "@/lib/admin/briefing-steps/market-sentiment";
import { buildBrief } from "./brief";
import { createEngineHandoffHandlers } from "./handoff";
import { createEngineRepository } from "./repository";

/** The weekly market digest: the existing Tavily steps, run server-side. */
async function researchMarket(): Promise<string> {
  const [competitors, sentiment] = await Promise.all([
    getCompetitorSearchContent(),
    getMarketSentimentContent(),
  ]);
  return `COMPETITOR ADS AND OFFERS\n\n${competitors}\n\n=====\n\nMARKET SENTIMENT\n\n${sentiment}`;
}

// Composition root for the three handoff routes: the handlers stay pure so
// their boundary can be proved without a database.
export function engineHandoffHandlers() {
  const repository = createEngineRepository();
  const now = () => new Date();
  return createEngineHandoffHandlers({
    repository,
    now,
    buildBrief: () =>
      buildBrief({
        repository,
        now,
        loadCopyBrief: loadOpsCopywriterBrief,
        brandFacts: BRAND_FACTS,
        marketResearch: process.env.TAVILY_API_KEY ? researchMarket : undefined,
      }),
    allowedFinalUrls: BRAND_FACTS.allowedFinalUrls,
  });
}
