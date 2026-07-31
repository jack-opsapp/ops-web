import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RUNTIME_DIRECTORIES = [
  "src/lib/catalog-setup/agent",
  "src/lib/catalog-setup/phase-c",
  "src/lib/catalog-setup/inventory",
] as const;

async function runtimeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.flatMap(async (entry) => {
        if (entry.name === "__tests__" || entry.name === "__fixtures__") {
          return [];
        }
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return runtimeFiles(path);
        return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
      }),
    )
  ).flat();
}

describe("catalog setup supplier neutrality", () => {
  it("keeps company and supplier names out of the catalog runtime", async () => {
    const paths = (
      await Promise.all(RUNTIME_DIRECTORIES.map(runtimeFiles))
    ).flat();
    const sources = await Promise.all(
      paths.map((path) => readFile(path, "utf8")),
    );

    expect(sources.join("\n")).not.toMatch(/canpro|deksmart/i);
  });
});
