import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("opportunity lifecycle mutation inventory", () => {
  it("routes operator stage, archive, unarchive, and deletion through guarded commands", () => {
    const source = read("src/lib/api/services/opportunity-service.ts");
    expect(source).toContain('.rpc("move_opportunity_stage"');
    expect(source).toContain('.rpc("mutate_opportunity_lifecycle"');
    expect(source).toContain(
      "Opportunity lifecycle fields require guarded commands"
    );
    expect(source).not.toMatch(
      /\.from\("opportunities"\)\s*\.update\(\{\s*deleted_at:/
    );
    expect(source).not.toMatch(
      /\.from\("opportunities"\)\s*\.update\(\{\s*archived_at:/
    );
  });

  it("routes email-driven opportunity archive and unarchive through the same command", () => {
    const source = read("src/lib/api/services/email-thread-service.ts");
    expect(source).toContain('"mutate_opportunity_lifecycle"');
    expect(source).not.toMatch(
      /\.from\("opportunities"\)[\s\S]{0,100}\.update\(\{\s*archived_at:/
    );
  });

  it("keeps merge and conversion in their existing guarded transactions", () => {
    expect(
      read("src/lib/api/services/duplicate-detection-service.ts")
    ).toContain('"execute_opportunity_merge_guarded"');
    expect(
      read("src/lib/api/services/project-conversion-service.ts")
    ).toContain('const CONVERSION_RPC = "convert_opportunity_to_project"');
  });
});
