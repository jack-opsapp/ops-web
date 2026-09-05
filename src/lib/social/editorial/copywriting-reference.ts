import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const SAM_PARR_GUIDE_PATH = "docs/social/voice/sam-parr-field-guide.md";

export function loadCopywritingReference() {
  const content = readFileSync(
    join(process.cwd(), SAM_PARR_GUIDE_PATH),
    "utf8"
  );
  if (!content.trim()) throw new Error("COPYWRITING_REFERENCE_EMPTY");
  return {
    path: SAM_PARR_GUIDE_PATH,
    sha256: createHash("sha256").update(content).digest("hex"),
    content,
  };
}
