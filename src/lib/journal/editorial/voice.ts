import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const JOURNAL_BRIEF_PATH = "docs/journal/voice/ops-journal-brief.md";
export const JOURNAL_GUIDE_PATH = "docs/journal/voice/blog-voice-sam-parr.md";
export const JOURNAL_FACTS_PATH = "docs/journal/voice/ops-product-facts.md";

export interface JournalReference {
  path: string;
  sha256: string;
  content: string;
}

function toReference(path: string, content: string): JournalReference {
  if (!content.trim()) throw new Error("JOURNAL_REFERENCE_EMPTY");
  return {
    path,
    sha256: createHash("sha256").update(content).digest("hex"),
    content,
  };
}

// Each document is read by its literal path so the build tracer can see it;
// next.config.ts also names the folder for every route that reads it. A file
// missing from the bundle throws on every claim and every tick (2026-09-08).

/** The governing journal voice, distilled from the ops-copywriter skill. */
export function loadJournalBrief(): JournalReference {
  return toReference(
    JOURNAL_BRIEF_PATH,
    readFileSync(
      join(process.cwd(), "docs/journal/voice/ops-journal-brief.md"),
      "utf8"
    )
  );
}

/** The Sam Parr long-form rhythm layer. */
export function loadJournalGuide(): JournalReference {
  return toReference(
    JOURNAL_GUIDE_PATH,
    readFileSync(
      join(process.cwd(), "docs/journal/voice/blog-voice-sam-parr.md"),
      "utf8"
    )
  );
}

/** The only OPS product claims a post may make. */
export function loadJournalProductFacts(): JournalReference {
  return toReference(
    JOURNAL_FACTS_PATH,
    readFileSync(
      join(process.cwd(), "docs/journal/voice/ops-product-facts.md"),
      "utf8"
    )
  );
}
