import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  buildTemplateSyncInputPaths,
  parseVersionFromSource,
  runTemplateVersionSync,
  sha256,
  type TemplateSyncEntry,
  type TemplateVersionStore,
} from "../../../scripts/email-template-version-sync-core";

const PREVIOUS_SHA = "1".repeat(40);
const CURRENT_SHA = "2".repeat(40);

const ENTRY: TemplateSyncEntry = {
  templateId: "test_template",
  previewProps: { firstName: "Jackson" },
  sourcePath: "src/lib/email/react/templates/TestTemplate.tsx",
};

const VALID_SOURCE =
  "// @template-version: 1.2.3\nexport const value = true;\n";

function makeStore(
  overrides: Partial<TemplateVersionStore> = {}
): TemplateVersionStore {
  return {
    findVersion: vi.fn().mockResolvedValue(null),
    insertVersion: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeOptions(
  overrides: Partial<Parameters<typeof runTemplateVersionSync>[0]> = {}
) {
  const store = makeStore();
  const createStore = vi.fn(() => store);
  const options: Parameters<typeof runTemplateVersionSync>[0] = {
    entries: [ENTRY],
    cwd: "/repo",
    env: {},
    readFile: vi.fn(() => Buffer.from(VALID_SOURCE)),
    renderTemplate: vi.fn().mockResolvedValue({ html: "<p>Preview</p>" }),
    runGitDiff: vi.fn(() => ({ status: 0 })),
    createStore,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  };

  return { options, store, createStore };
}

describe("email template version sync", () => {
  it("imports and exercises the real version parser and hash helper", () => {
    expect(parseVersionFromSource("// @template-version: 1.0.0\nfoo")).toBe(
      "1.0.0"
    );
    expect(parseVersionFromSource("// @template-version: 12.34.567\n")).toBe(
      "12.34.567"
    );
    expect(parseVersionFromSource("// @template-version: 1.0\n")).toBeNull();
    expect(parseVersionFromSource("// @template-version: latest\n")).toBeNull();
    expect(sha256("hello")).toBe(sha256("hello"));
    expect(sha256("hello")).not.toBe(sha256("hello!"));
  });

  it("validates source comments before honoring an explicit local DB skip", async () => {
    const { options, createStore } = makeOptions({
      env: { SYNC_SKIP_DB: "1" },
      readFile: vi.fn(() => Buffer.from("export const value = true;\n")),
    });

    await expect(runTemplateVersionSync(options)).rejects.toThrow(
      "missing @template-version comment"
    );
    expect(createStore).not.toHaveBeenCalled();
  });

  it("skips remote synchronization for an unchanged production Vercel template tree", async () => {
    const runGitDiff = vi.fn(() => ({ status: 0 }));
    const { options, createStore } = makeOptions({
      env: {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_PREVIOUS_SHA: PREVIOUS_SHA,
        VERCEL_GIT_COMMIT_SHA: CURRENT_SHA,
      },
      runGitDiff,
    });

    const result = await runTemplateVersionSync(options);

    expect(result).toMatchObject({
      remoteAction: "skipped",
      remoteReason: "template_inputs_unchanged",
      validated: 1,
    });
    expect(createStore).not.toHaveBeenCalled();
    expect(runGitDiff).toHaveBeenCalledWith(
      PREVIOUS_SHA,
      CURRENT_SHA,
      expect.arrayContaining([
        "src/lib/email/template-registry.ts",
        ENTRY.sourcePath,
        "src/lib/email/react/layouts",
        "src/lib/email/react/primitives",
        "src/lib/email/senders.ts",
        "src/lib/email/constants.ts",
      ])
    );
  });

  it("requires the database when a production template input changed", async () => {
    const { options, createStore } = makeOptions({
      env: {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_PREVIOUS_SHA: PREVIOUS_SHA,
        VERCEL_GIT_COMMIT_SHA: CURRENT_SHA,
      },
      runGitDiff: vi.fn(() => ({ status: 1 })),
    });

    await expect(runTemplateVersionSync(options)).rejects.toThrow(
      "database credentials are required"
    );
    expect(createStore).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "the previous SHA is missing",
      env: {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_COMMIT_SHA: CURRENT_SHA,
      },
      runGitDiff: vi.fn(() => ({ status: 0 })),
    },
    {
      name: "a SHA is invalid",
      env: {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_PREVIOUS_SHA: "not-a-sha",
        VERCEL_GIT_COMMIT_SHA: CURRENT_SHA,
      },
      runGitDiff: vi.fn(() => ({ status: 0 })),
    },
    {
      name: "git diff fails",
      env: {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_PREVIOUS_SHA: PREVIOUS_SHA,
        VERCEL_GIT_COMMIT_SHA: CURRENT_SHA,
      },
      runGitDiff: vi.fn(() => ({ status: 128, error: "bad revision" })),
    },
  ])("fails closed when $name", async ({ env, runGitDiff }) => {
    const { options, createStore } = makeOptions({ env, runGitDiff });

    await expect(runTemplateVersionSync(options)).rejects.toThrow(
      "database credentials are required"
    );
    expect(createStore).not.toHaveBeenCalled();
  });

  it("rejects an explicit production DB bypass for changed or unknown inputs", async () => {
    const { options, createStore } = makeOptions({
      env: {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_PREVIOUS_SHA: PREVIOUS_SHA,
        VERCEL_GIT_COMMIT_SHA: CURRENT_SHA,
        SYNC_SKIP_DB: "1",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
      },
      runGitDiff: vi.fn(() => ({ status: 1 })),
    });

    await expect(runTemplateVersionSync(options)).rejects.toThrow(
      "SYNC_SKIP_DB=1 is not permitted"
    );
    expect(createStore).not.toHaveBeenCalled();
  });

  it("rejects a production dry run when changed inputs require persistence", async () => {
    const { options, createStore } = makeOptions({
      env: {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_PREVIOUS_SHA: PREVIOUS_SHA,
        VERCEL_GIT_COMMIT_SHA: CURRENT_SHA,
        SYNC_DRY_RUN: "1",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
      },
      runGitDiff: vi.fn(() => ({ status: 1 })),
    });

    await expect(runTemplateVersionSync(options)).rejects.toThrow(
      "SYNC_DRY_RUN=1 is not permitted"
    );
    expect(createStore).not.toHaveBeenCalled();
  });

  it("keeps PostgREST schema-cache failures fatal when synchronization is required", async () => {
    const store = makeStore({
      findVersion: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "PGRST002: Could not query the database for the schema cache"
          )
        ),
    });
    const { options } = makeOptions({
      env: {
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_GIT_PREVIOUS_SHA: PREVIOUS_SHA,
        VERCEL_GIT_COMMIT_SHA: CURRENT_SHA,
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
      },
      runGitDiff: vi.fn(() => ({ status: 1 })),
      createStore: vi.fn(() => store),
    });

    await expect(runTemplateVersionSync(options)).rejects.toThrow("PGRST002");
  });

  it("fails when an existing version has a different content hash", async () => {
    const store = makeStore({
      findVersion: vi.fn().mockResolvedValue({
        id: "version-1",
        contentHash: "different-hash",
      }),
    });
    const { options } = makeOptions({
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
      },
      createStore: vi.fn(() => store),
    });

    await expect(runTemplateVersionSync(options)).rejects.toThrow(
      "HASH MISMATCH"
    );
    expect(store.insertVersion).not.toHaveBeenCalled();
  });

  it("inserts a missing reachable version exactly once", async () => {
    const store = makeStore();
    const { options } = makeOptions({
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
      },
      createStore: vi.fn(() => store),
    });

    const result = await runTemplateVersionSync(options);

    expect(result).toMatchObject({
      remoteAction: "synchronized",
      inserts: 1,
      unchanged: 0,
      mismatches: 0,
    });
    expect(store.insertVersion).toHaveBeenCalledTimes(1);
    expect(store.insertVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: ENTRY.templateId,
        version: "1.2.3",
        contentHash: sha256(VALID_SOURCE),
        renderedSampleHtml: "<p>Preview</p>",
      })
    );
  });

  it("keeps the production build wired to the mandatory sync command", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.prebuild).toBe("npm run email:sync-versions");
    expect(pkg.scripts?.prebuild).not.toContain("|| true");
    expect(pkg.scripts?.["email:sync-versions"]).toContain(
      "email-template-version-sync.ts"
    );
  });

  it("deduplicates every registered and shared template input path", () => {
    expect(buildTemplateSyncInputPaths([ENTRY, ENTRY])).toEqual(
      expect.arrayContaining([
        ENTRY.sourcePath,
        "src/lib/email/template-registry.ts",
        "src/lib/email/react/layouts",
        "src/lib/email/react/primitives",
      ])
    );
    expect(new Set(buildTemplateSyncInputPaths([ENTRY, ENTRY])).size).toBe(
      buildTemplateSyncInputPaths([ENTRY, ENTRY]).length
    );
  });
});
