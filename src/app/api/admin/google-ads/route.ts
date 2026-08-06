import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin/api-auth";
import {
  getGoogleAdsPageData,
  isAdsRangePreset,
  type AdsRangePreset,
} from "@/lib/admin/google-ads-page-data";

/** Legacy ?days= values from before the preset param; kept for back-compat. */
const DAYS_TO_PRESET: Record<string, AdsRangePreset> = {
  "7": "7d",
  "14": "14d",
  "30": "30d",
  "90": "90d",
};

function parsePreset(req: NextRequest): AdsRangePreset {
  const preset = req.nextUrl.searchParams.get("preset");
  if (isAdsRangePreset(preset)) return preset;

  const days = req.nextUrl.searchParams.get("days");
  if (days && DAYS_TO_PRESET[days]) return DAYS_TO_PRESET[days];

  return "30d";
}

export const GET = withAdmin(async (req: NextRequest) => {
  const data = await getGoogleAdsPageData(parsePreset(req));
  return NextResponse.json(data);
});
