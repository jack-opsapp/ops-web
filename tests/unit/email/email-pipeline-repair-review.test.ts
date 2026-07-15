import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(
    process.cwd(),
    "docs/backfills/2026-07-13-email-lead-project-repair-review.sql"
  ),
  "utf8"
);

describe("email pipeline repair review artifact", () => {
  it("defaults to read-only discovery and rolls back unless apply and commit are explicit", () => {
    expect(source).toMatch(/\\set apply false/i);
    expect(source).toMatch(/\\set commit false/i);
    expect(source).toMatch(/set transaction read only/i);
    expect(source).toMatch(
      /\\if :apply[\s\S]*?\\if :commit[\s\S]*?commit;[\s\S]*?rollback;/i
    );
  });

  it("requires exact approved allowlist rows before entering mutation logic", () => {
    expect(source).toMatch(
      /if v_approved = 0 then[\s\S]*?no exact allowlist row has approved=true/i
    );
    expect(source).toMatch(/expected_provider_message_id text not null/i);
    expect(source).toMatch(/expected_target_source_thread_key text not null/i);
  });

  it("recomputes email chronology from correspondence occurrence time, not import time", () => {
    expect(source).toMatch(
      /select max\(e\.occurred_at\)[\s\S]*?e\.activity_id = a\.id[\s\S]*?a\.created_at[\s\S]*?effective_occurred_at/i
    );
    expect(source).toMatch(
      /order by latest\.effective_occurred_at desc, latest\.id desc/i
    );
  });
});
