import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const SAM_PARR_GUIDE_PATH = "docs/social/voice/sam-parr-field-guide.md";
// The governing voice, distilled from the ops-copywriter skill. The Sam Parr
// guide is the pacing layer underneath it; both travel with every assignment.
export const OPS_COPYWRITER_BRIEF_PATH =
  "docs/social/voice/ops-copywriter-brief.md";

export interface CopywritingReference {
  path: string;
  sha256: string;
  content: string;
}

function toReference(path: string, content: string): CopywritingReference {
  if (!content.trim()) throw new Error("COPYWRITING_REFERENCE_EMPTY");
  return {
    path,
    sha256: createHash("sha256").update(content).digest("hex"),
    content,
  };
}

// Each document is read with its literal path so the build tracer can also
// see it; next.config.ts names the folder explicitly for every consumer route.

/** The Sam Parr field guide: pacing, hooks, quiet thoughts, subtraction. */
export function loadCopywritingReference(): CopywritingReference {
  return toReference(
    SAM_PARR_GUIDE_PATH,
    readFileSync(
      join(process.cwd(), "docs/social/voice/sam-parr-field-guide.md"),
      "utf8"
    )
  );
}

/** The OPS copywriter brief: the founder voice every post is written in. */
export function loadOpsCopywriterBrief(): CopywritingReference {
  return toReference(
    OPS_COPYWRITER_BRIEF_PATH,
    readFileSync(
      join(process.cwd(), "docs/social/voice/ops-copywriter-brief.md"),
      "utf8"
    )
  );
}
