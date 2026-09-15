/**
 * Retired text plates. Before generated photographs (2026-09-15), OPS rendered
 * a typographic plate under this prefix, in S3 or in the Supabase `images`
 * bucket, and assignment previews from that week still point at them. A plate
 * is typography, not a photograph, so Instagram must never use one as a cover
 * (see social/editorial/repository.ts).
 */
export const JOURNAL_HERO_PREFIX = "blog/journal/";

export function isJournalHeroUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).pathname.includes(`/${JOURNAL_HERO_PREFIX}`);
  } catch {
    return false;
  }
}
