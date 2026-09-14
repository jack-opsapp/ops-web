/**
 * Every OPS-rendered journal plate lives under this key prefix, in S3 or in the
 * Supabase `images` bucket. The plate is typography, so Instagram must never
 * lay its own cover text over it (see social/editorial/repository.ts).
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
