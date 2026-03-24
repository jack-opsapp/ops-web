import { getLatestBriefing } from "@/lib/admin/briefing-queries";
import { BriefingHeroClient } from "./briefing-hero-client";

export async function BriefingHero() {
  const briefing = await getLatestBriefing();
  return <BriefingHeroClient briefing={briefing} />;
}
