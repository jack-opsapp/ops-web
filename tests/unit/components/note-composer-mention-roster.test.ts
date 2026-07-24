import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/components/ops/note-composer.tsx"),
  "utf8"
);

describe("NoteComposer mention roster", () => {
  it("passes the current user roster into authoritative mention extraction", () => {
    expect(source).toContain("extractMentionedUserIds(trimmed, users)");
  });
});
