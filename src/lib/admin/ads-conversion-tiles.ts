/**
 * OPS Admin — Google Ads conversion tiles
 *
 * Pure. Safe to import from client components.
 *
 * The dashboard asks two questions of conversion data: what does a signup
 * cost, and what does an app install cost. Google answers with a list of
 * individually-named conversion actions ("Join Ops SIgnup", "Quiz Signup v2",
 * "Homepage Signup", "OPS APP First open") — the data model, not the answer.
 * Turning that list into the two numbers is this module's whole job:
 *
 *   • select by Google's own category (SIGNUP / DOWNLOAD), because names are
 *     operator-typed and lie — "OPS APP First open" IS an install
 *   • sum EVERY matching action, because three signup funnels are still
 *     signups; picking the first one silently undercounts
 *   • cost against total window spend, the only cost Google attributes
 */
import type { ConversionBreakdown } from "@/lib/analytics/google-ads-types";

export interface ConversionTile {
  /** Total conversions across every action that matched. */
  conversions: number;
  /** Window spend / conversions; null when nothing converted. */
  cpa: number | null;
  /** Action names that fed this tile, most conversions first. */
  actions: string[];
}

interface TileSpec {
  /** Google conversion-action categories that belong to this tile. */
  categories: string[];
  /** Name fallback for rows whose category Google did not return. */
  namePattern: RegExp;
}

export const SIGNUP_TILE: TileSpec = {
  categories: ["SIGNUP"],
  namePattern: /sign[\s_-]?up|trial/i,
};

export const INSTALL_TILE: TileSpec = {
  categories: ["DOWNLOAD"],
  namePattern: /install|first[\s_-]?open|download/i,
};

/**
 * Collapse the conversion-action list into one tile.
 * Category wins when present; the name pattern only covers rows Google
 * returned without a category.
 */
export function conversionTile(
  rows: ConversionBreakdown[],
  totalSpend: number,
  spec: TileSpec
): ConversionTile {
  const matched = rows.filter((row) =>
    row.category
      ? spec.categories.includes(row.category)
      : spec.namePattern.test(row.actionName)
  );

  const conversions = matched.reduce((sum, row) => sum + row.conversions, 0);

  return {
    conversions,
    cpa: conversions > 0 ? totalSpend / conversions : null,
    actions: [...matched]
      .sort((a, b) => b.conversions - a.conversions)
      .map((row) => row.actionName),
  };
}
