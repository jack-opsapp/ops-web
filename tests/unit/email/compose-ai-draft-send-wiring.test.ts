import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("compose AI draft send wiring", () => {
  it("uses the Firebase-authenticated fetch boundary for protected email routes", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/ops/compose-email-form.tsx"),
      "utf8"
    );

    expect(source).toContain(
      'import { authedFetch } from "@/lib/utils/authed-fetch";'
    );
    expect(source).toContain("await authedFetch(");
    expect(source).toContain(
      'authedFetch("/api/integrations/email/ai-draft", {'
    );
    expect(source).toContain(
      'authedFetch("/api/integrations/email/draft-feedback", {'
    );
    expect(source).toContain('authedFetch("/api/integrations/email/send", {');
    expect(source).not.toMatch(/\bfetch\(\s*[`"]\/api\/integrations\/email\//);
  });

  it("carries the draft history identity inside the canonical send request", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/ops/compose-email-form.tsx"),
      "utf8"
    );

    const payloadBlock = source.match(
      /const payload = \{[\s\S]*?format: "markdown" as const,[\s\S]*?\};/
    )?.[0];

    expect(payloadBlock).toContain("draftHistoryId:");
    expect(payloadBlock).toContain("aiState.draftHistoryId");
  });

  it("distinguishes an unchanged template subject from later operator typing", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/ops/compose-email-form.tsx"),
      "utf8"
    );

    expect(source).toContain('setSubjectSource("configured")');
    expect(source).toContain('setSubjectSource("operator")');
    expect(source).toContain(
      "...subjectDraftRequestFields(subject, subjectSource)"
    );
    expect(source).toMatch(
      /mode === "reply"\s*\?\s*"thread"\s*:\s*composeData\?\.subject\s*\?\s*"configured"\s*:\s*"operator"/
    );
  });
});
