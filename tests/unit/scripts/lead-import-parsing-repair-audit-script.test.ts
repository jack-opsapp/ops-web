import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.join(
  process.cwd(),
  "scripts/lead-import-parsing-repair-audit.ts"
);

function scriptSource(): string {
  return readFileSync(scriptPath, "utf8");
}

describe("lead import parsing repair audit script", () => {
  it("requires exact opportunity ids before apply mode can write live repairs", () => {
    const source = scriptSource();

    expect(source).toContain("--opportunity-id <uuid>");
    expect(source).toContain(
      'const OPPORTUNITY_IDS = cliValues("--opportunity-id")'
    );
    expect(source).toContain("if (APPLY && OPPORTUNITY_IDS.length === 0)");
    expect(source).toContain(
      "Live apply requires at least one --opportunity-id"
    );
    expect(source).toMatch(
      /OPPORTUNITY_ID_SET\.size === 0\s*\|\|\s*OPPORTUNITY_ID_SET\.has\(candidate\.opportunity\.id\)/
    );
  });

  it("uses the script service-role client for conversion instead of the app client service", () => {
    const source = scriptSource();

    expect(source).toContain(
      'const CONVERSION_RPC = "convert_opportunity_to_project"'
    );
    expect(source).toContain("await sb.rpc(CONVERSION_RPC");
    expect(source).not.toContain("ProjectConversionService");
  });
});
