import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("protected email route client authentication", () => {
  it("uses authedFetch for pipeline follow-up sends", () => {
    const widget = source(
      "src/components/dashboard/widgets/pipeline-list-widget.tsx"
    );

    expect(widget).toContain('authedFetch("/api/integrations/email/send", {');
    expect(widget).not.toContain('fetch("/api/integrations/email/send", {');
  });

  it("uses authedFetch for wizard connection persistence and activation", () => {
    const wizard = source("src/components/settings/import-pipeline-wizard.tsx");

    expect(wizard).toContain(
      'authedFetch("/api/integrations/email/connection", {'
    );
    expect(wizard).toContain(
      'authedFetch("/api/integrations/email/activate", {'
    );
    expect(wizard).not.toMatch(
      /\bfetch\(\s*"\/api\/integrations\/email\/(?:connection|activate)"/
    );
  });
});
