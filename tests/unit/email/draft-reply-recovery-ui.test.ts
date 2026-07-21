import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const component = readFileSync(
  path.join(root, "src/components/pipeline/draft-reply-button.tsx"),
  "utf8"
);
const dictionary = JSON.parse(
  readFileSync(
    path.join(root, "src/i18n/dictionaries/en/pipeline.json"),
    "utf8"
  )
) as Record<string, string>;

describe("manual draft recovery UI", () => {
  it("preserves an ambiguous mailbox outcome instead of generating a new attempt", () => {
    expect(component).toContain("mailboxErrorCode?: string | null");
    expect(component).toMatch(
      /mailboxErrorCode ===\s*"EMAIL_PROVIDER_MUTATION_RECONCILIATION_REQUIRED"/
    );
    expect(component).toMatch(
      /if \(mailboxPlacementUnknown\) \{\s*setShowModal\(true\);\s*return;/
    );
  });

  it("tells the operator the truthful recovery action", () => {
    expect(dictionary["draft.mailboxOutcomeUnknown"]).toBe(
      "Draft status is unknown in {mailbox}. Check Drafts before trying again."
    );
    expect(component).toContain('t("draft.mailboxOutcomeUnknown"');
  });
});
