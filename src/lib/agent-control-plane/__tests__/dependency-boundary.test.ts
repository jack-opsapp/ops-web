import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.join(process.cwd(), "src");
const APPROVED_SDK_DIRECTORIES = [
  path.join(SOURCE_ROOT, "lib", "agent-control-plane", "mcp"),
  path.join(SOURCE_ROOT, "app", "mcp"),
];
const MCP_PACKAGE_PREFIX = ["@modelcontextprotocol", ""].join("/");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(entryPath);
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? [entryPath] : [];
    }),
  );

  return files.flat();
}

describe("MCP SDK dependency boundary", () => {
  it("loads the approved server symbols through the OPS adapter", async () => {
    const adapterUrl = pathToFileURL(
      path.join(
        SOURCE_ROOT,
        "lib",
        "agent-control-plane",
        "mcp",
        "sdk.ts",
      ),
    ).href;

    const adapter = await import(/* @vite-ignore */ adapterUrl);

    expect(adapter.McpServer).toBeTypeOf("function");
    expect(adapter.createMcpHandler).toBeTypeOf("function");
  });

  it("keeps direct SDK imports inside the MCP transport boundary", async () => {
    const files = await sourceFiles(SOURCE_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      if (
        APPROVED_SDK_DIRECTORIES.some(
          (directory) => file === directory || file.startsWith(`${directory}${path.sep}`),
        )
      ) {
        continue;
      }

      const contents = await readFile(file, "utf8");
      if (contents.includes(MCP_PACKAGE_PREFIX)) {
        violations.push(path.relative(process.cwd(), file));
      }
    }

    expect(violations).toEqual([]);
  });
});
