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

function loadReference(path: string): CopywritingReference {
  const content = readFileSync(join(process.cwd(), path), "utf8");
  if (!content.trim()) throw new Error("COPYWRITING_REFERENCE_EMPTY");
  return {
    path,
    sha256: createHash("sha256").update(content).digest("hex"),
    content,
  };
}

/** The Sam Parr field guide: pacing, hooks, quiet thoughts, subtraction. */
export function loadCopywritingReference(): CopywritingReference {
  return loadReference(SAM_PARR_GUIDE_PATH);
}

/** The OPS copywriter brief: the founder voice every post is written in. */
export function loadOpsCopywriterBrief(): CopywritingReference {
  return loadReference(OPS_COPYWRITER_BRIEF_PATH);
}
