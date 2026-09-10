import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../../next.config";

// Every route that reads the journal voice documents from disk must name the
// folder in its tracing include, or the file is silently absent from the
// production bundle and the route throws on its first call (the 2026-09-08
// Instagram incident).
const VOICE_INCLUDE = "./docs/journal/voice/*.md";
const API_ROOT = join(process.cwd(), "src/app/api");
const READERS = [
  "@/lib/journal/editorial/voice",
  "@/lib/journal/editorial/handoff-runtime",
];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

function routePath(file: string): string {
  return "/" + relative(join(process.cwd(), "src/app"), file).replace(/\/route\.ts$/, "");
}

describe("journal voice document bundling", () => {
  const includes = (nextConfig("phase-production-build").outputFileTracingIncludes ??
    {}) as Record<string, string[]>;
  const readerRoutes = routeFiles(API_ROOT).filter((file) => {
    const source = readFileSync(file, "utf8");
    return READERS.some((reader) => source.includes(reader));
  });

  it("finds the routes that read the journal voice documents", () => {
    expect(readerRoutes.map(routePath).sort()).toEqual([
      "/api/internal/journal/editorial/assignments/[id]/draft",
      "/api/internal/journal/editorial/assignments/[id]/release",
      "/api/internal/journal/editorial/assignments/[id]/sources",
      "/api/internal/journal/editorial/claim",
    ]);
  });

  it("names the voice folder in every reader route's tracing include", () => {
    for (const file of readerRoutes)
      expect(includes[routePath(file)], routePath(file)).toContain(VOICE_INCLUDE);
  });

  it("ships the three documents every claim hands to the routine", () => {
    for (const name of ["ops-journal-brief.md", "blog-voice-sam-parr.md", "ops-product-facts.md"])
      expect(
        readFileSync(join(process.cwd(), "docs/journal/voice", name), "utf8").trim().length
      ).toBeGreaterThan(3000);
  });
});
