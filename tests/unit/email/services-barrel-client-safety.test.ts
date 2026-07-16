import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve(process.cwd(), "src");
const SERVICES_BARREL = resolve(SOURCE_ROOT, "lib/api/services/index.ts");

const SERVER_ONLY_RUNTIME_MODULES = [
  "email-service",
  "pattern-detection-service",
  "email-ai-classifier",
  "admin-feature-override-service",
  "ai-sync-reviewer",
  "writing-profile-service",
  "approval-queue-service",
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("API services barrel client safety", () => {
  it("does not re-export server-only runtime services", () => {
    const barrel = readFileSync(SERVICES_BARREL, "utf8");

    expect(barrel).not.toMatch(/from\s+["']\.\/memory-service["']/);
    expect(barrel).not.toMatch(/from\s+["']\.\/draft-generator["']/);
    for (const moduleName of SERVER_ONLY_RUNTIME_MODULES) {
      expect(barrel).not.toMatch(
        new RegExp(`export\\s+\\{[^}]+\\}\\s+from\\s+["']\\./${moduleName}["']`)
      );
    }
  });

  it("keeps production modules off the mixed services barrel", () => {
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((path) => path !== SERVICES_BARREL)
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return (
          /from\s+["']@\/lib\/api\/services["']/.test(source) ||
          /from\s+["']\.\.\/api\/services["']/.test(source) ||
          /import\(\s*["']@\/lib\/api\/services["']\s*\)/.test(source)
        );
      })
      .map((path) => path.slice(SOURCE_ROOT.length + 1))
      .sort();

    expect(offenders).toEqual([]);
  });

  it("keeps client email-connection hooks behind the authenticated browser service", () => {
    const hook = readFileSync(
      resolve(SOURCE_ROOT, "lib/hooks/use-email-connections.ts"),
      "utf8"
    );
    const legacyHook = readFileSync(
      resolve(SOURCE_ROOT, "lib/hooks/use-gmail-connections.ts"),
      "utf8"
    );
    const persistence = readFileSync(
      resolve(SOURCE_ROOT, "lib/api/services/email-connection-service.ts"),
      "utf8"
    );

    expect(hook).not.toMatch(/services\/email-service/);
    expect(hook).not.toMatch(/services\/email-connection-service["']/);
    expect(hook).toMatch(/services\/email-connection-browser-service/);
    expect(legacyHook).not.toMatch(/services\/gmail-service["']/);
    expect(legacyHook).toMatch(/services\/email-connection-browser-service/);
    expect(persistence).toMatch(/import\s+["']server-only["']/);
  });

  it("keeps the client sibling-thread hook off the server orchestration service", () => {
    const hook = readFileSync(
      resolve(process.cwd(), "src/lib/hooks/use-client-threads.ts"),
      "utf8"
    );

    expect(hook).not.toMatch(/email-thread-service/);
  });

  it("keeps the communications wizard on the canonical sanitized connection API", () => {
    const wizard = readFileSync(
      resolve(
        SOURCE_ROOT,
        "components/agent/comms-config-wizard/comms-config-wizard.tsx"
      ),
      "utf8"
    );

    expect(wizard).toMatch(/EmailConnectionBrowserService\.getConnections/);
    expect(wizard).not.toMatch(/api\/integrations\/email\/connections/);
    expect(wizard).not.toMatch(/\.user_id\b/);
    expect(wizard).not.toMatch(/status\s*===\s*["']connected["']/);
  });
});
