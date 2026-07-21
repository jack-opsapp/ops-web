import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ALLOWED_FACTORY = path.normalize(
  "src/lib/api/services/openai-clients.ts"
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

describe("OpenAI constructor boundary", () => {
  it("keeps every production OpenAI constructor inside the monitored factory", () => {
    const root = process.cwd();
    const offenders = sourceFiles(path.join(root, "src"))
      .filter((file) => /\bnew\s+OpenAI\s*\(/.test(readFileSync(file, "utf8")))
      .map((file) => path.normalize(path.relative(root, file)))
      .filter((file) => file !== ALLOWED_FACTORY)
      .sort();

    expect(offenders).toEqual([]);
  });
});
