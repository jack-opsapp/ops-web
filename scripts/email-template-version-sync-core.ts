import { createHash } from "node:crypto";
import { resolve } from "node:path";

const VERSION_COMMENT_RE =
  /^\s*\/\/\s*@template-version:\s*(\d+\.\d+\.\d+)\s*$/m;
const FULL_GIT_SHA_RE = /^[0-9a-f]{40}$/i;

const SHARED_TEMPLATE_INPUT_PATHS = [
  "src/lib/email/template-registry.ts",
  "src/lib/email/react/layouts",
  "src/lib/email/react/primitives",
  "src/lib/email/senders.ts",
  "src/lib/email/constants.ts",
] as const;

export interface TemplateSyncEntry {
  templateId: string;
  previewProps: unknown;
  sourcePath: string;
}

export interface TemplateVersionStore {
  findVersion(
    templateId: string,
    version: string
  ): Promise<{ id: string; contentHash: string } | null>;
  insertVersion(input: {
    templateId: string;
    version: string;
    contentHash: string;
    renderedSampleHtml: string | null;
    previewProps: unknown;
    notes: string | null;
  }): Promise<void>;
}

export interface TemplateSyncLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface GitDiffResult {
  status: number | null;
  error?: string;
}

export type TemplateInputDiffStatus = "unchanged" | "changed" | "unknown";

export interface RunTemplateVersionSyncOptions {
  entries: TemplateSyncEntry[];
  cwd: string;
  env: Record<string, string | undefined>;
  readFile(path: string): Buffer | string;
  renderTemplate(
    templateId: string,
    previewProps: unknown
  ): Promise<{ html?: string | null } | null | undefined>;
  runGitDiff(
    previousSha: string,
    currentSha: string,
    inputPaths: string[]
  ): GitDiffResult;
  createStore(credentials: {
    url: string;
    serviceRoleKey: string;
  }): TemplateVersionStore;
  logger: TemplateSyncLogger;
}

export interface TemplateVersionSyncResult {
  validated: number;
  remoteAction: "skipped" | "synchronized";
  remoteReason:
    | "template_inputs_unchanged"
    | "explicit_nonproduction_skip"
    | "nonproduction_credentials_missing"
    | "database_sync_required";
  inserts: number;
  unchanged: number;
  mismatches: number;
}

interface ValidatedTemplateSource {
  entry: TemplateSyncEntry;
  source: Buffer;
  version: string;
  contentHash: string;
}

export function parseVersionFromSource(source: string): string | null {
  const match = VERSION_COMMENT_RE.exec(source);
  return match ? match[1] : null;
}

export function sha256(source: Buffer | string): string {
  return createHash("sha256").update(source).digest("hex");
}

export function buildTemplateSyncInputPaths(
  entries: TemplateSyncEntry[]
): string[] {
  return Array.from(
    new Set([
      ...SHARED_TEMPLATE_INPUT_PATHS,
      ...entries.map((entry) => entry.sourcePath),
    ])
  ).sort();
}

function validateTemplateSources(
  entries: TemplateSyncEntry[],
  cwd: string,
  readFile: RunTemplateVersionSyncOptions["readFile"]
): ValidatedTemplateSource[] {
  return entries.map((entry) => {
    const fullPath = resolve(cwd, entry.sourcePath);
    const rawSource = readFile(fullPath);
    const source = Buffer.isBuffer(rawSource)
      ? rawSource
      : Buffer.from(rawSource, "utf8");
    const version = parseVersionFromSource(source.toString("utf8"));

    if (!version) {
      throw new Error(
        `[sync] ${entry.templateId} :: missing @template-version comment in ${entry.sourcePath}`
      );
    }

    return {
      entry,
      source,
      version,
      contentHash: sha256(source),
    };
  });
}

function isProductionVercel(
  env: RunTemplateVersionSyncOptions["env"]
): boolean {
  const target = env.VERCEL_TARGET_ENV ?? env.VERCEL_ENV;
  return env.VERCEL === "1" && target === "production";
}

function assessTemplateInputDiff(input: {
  previousSha?: string;
  currentSha?: string;
  inputPaths: string[];
  runGitDiff: RunTemplateVersionSyncOptions["runGitDiff"];
}): { status: TemplateInputDiffStatus; detail?: string } {
  const { previousSha, currentSha, inputPaths, runGitDiff } = input;

  if (
    !previousSha ||
    !currentSha ||
    !FULL_GIT_SHA_RE.test(previousSha) ||
    !FULL_GIT_SHA_RE.test(currentSha)
  ) {
    return {
      status: "unknown",
      detail: "missing_or_invalid_deployment_sha",
    };
  }

  let result: GitDiffResult;
  try {
    result = runGitDiff(previousSha, currentSha, inputPaths);
  } catch (error) {
    return {
      status: "unknown",
      detail:
        error instanceof Error ? error.message : "git_diff_threw_unknown_error",
    };
  }

  if (result.status === 0) {
    return { status: "unchanged" };
  }
  if (result.status === 1) {
    return { status: "changed" };
  }

  return {
    status: "unknown",
    detail: result.error ?? `git_diff_exit_${String(result.status)}`,
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function runTemplateVersionSync(
  options: RunTemplateVersionSyncOptions
): Promise<TemplateVersionSyncResult> {
  const {
    entries,
    cwd,
    env,
    readFile,
    renderTemplate,
    runGitDiff,
    createStore,
    logger,
  } = options;

  // This local validation is mandatory regardless of any remote-sync policy.
  const sources = validateTemplateSources(entries, cwd, readFile);
  const inputPaths = buildTemplateSyncInputPaths(entries);
  const productionVercel = isProductionVercel(env);
  const explicitSkip = env.SYNC_SKIP_DB === "1";
  const dryRun = env.SYNC_DRY_RUN === "1";

  let diffStatus: TemplateInputDiffStatus | null = null;
  let diffDetail: string | undefined;
  if (productionVercel) {
    const diff = assessTemplateInputDiff({
      previousSha: env.VERCEL_GIT_PREVIOUS_SHA,
      currentSha: env.VERCEL_GIT_COMMIT_SHA,
      inputPaths,
      runGitDiff,
    });
    diffStatus = diff.status;
    diffDetail = diff.detail;

    if (diffStatus === "unchanged") {
      logger.info(
        `[sync] remote_sync=skipped reason=template_inputs_unchanged validated=${sources.length}`
      );
      return {
        validated: sources.length,
        remoteAction: "skipped",
        remoteReason: "template_inputs_unchanged",
        inserts: 0,
        unchanged: 0,
        mismatches: 0,
      };
    }

    if (explicitSkip) {
      throw new Error(
        `[sync] SYNC_SKIP_DB=1 is not permitted for production template inputs with diff_status=${diffStatus}.`
      );
    }
    if (dryRun) {
      throw new Error(
        `[sync] SYNC_DRY_RUN=1 is not permitted for production template inputs with diff_status=${diffStatus}.`
      );
    }
  } else if (explicitSkip) {
    logger.info(
      `[sync] remote_sync=skipped reason=explicit_nonproduction_skip validated=${sources.length}`
    );
    return {
      validated: sources.length,
      remoteAction: "skipped",
      remoteReason: "explicit_nonproduction_skip",
      inserts: 0,
      unchanged: 0,
      mismatches: 0,
    };
  }

  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    if (productionVercel || env.SYNC_REQUIRE_DB === "1") {
      const suffix = productionVercel
        ? ` (template diff_status=${diffStatus}${
            diffDetail ? `, detail=${diffDetail}` : ""
          })`
        : "";
      throw new Error(
        `[sync] database credentials are required for template synchronization${suffix}.`
      );
    }

    logger.warn(
      `[sync] remote_sync=skipped reason=nonproduction_credentials_missing validated=${sources.length}`
    );
    return {
      validated: sources.length,
      remoteAction: "skipped",
      remoteReason: "nonproduction_credentials_missing",
      inserts: 0,
      unchanged: 0,
      mismatches: 0,
    };
  }

  const store = createStore({ url, serviceRoleKey });
  let inserts = 0;
  let unchanged = 0;
  let mismatches = 0;

  for (const source of sources) {
    const { entry, version, contentHash } = source;
    let existing: Awaited<ReturnType<TemplateVersionStore["findVersion"]>>;
    try {
      existing = await store.findVersion(entry.templateId, version);
    } catch (error) {
      throw new Error(
        `[sync] ${entry.templateId} :: read failed: ${formatError(error)}`
      );
    }

    if (existing) {
      if (existing.contentHash === contentHash) {
        logger.info(`[sync] ${entry.templateId} v${version} :: unchanged`);
        unchanged += 1;
      } else {
        logger.error(
          `[sync] ${entry.templateId} v${version} :: HASH MISMATCH. ` +
            `Existing: ${existing.contentHash.slice(0, 12)}, current: ${contentHash.slice(0, 12)}. ` +
            "Bump the @template-version comment before changing the source."
        );
        mismatches += 1;
      }
      continue;
    }

    let renderedSampleHtml: string | null = null;
    try {
      const rendered = await renderTemplate(
        entry.templateId,
        entry.previewProps
      );
      renderedSampleHtml = rendered?.html ?? null;
    } catch (error) {
      logger.warn(
        `[sync] ${entry.templateId} v${version} :: render failed (continuing without sample): ${formatError(error)}`
      );
    }

    if (dryRun) {
      logger.info(
        `[sync DRY] ${entry.templateId} v${version} :: would insert (hash ${contentHash.slice(0, 12)})`
      );
      inserts += 1;
      continue;
    }

    try {
      await store.insertVersion({
        templateId: entry.templateId,
        version,
        contentHash,
        renderedSampleHtml,
        previewProps: entry.previewProps,
        notes: null,
      });
    } catch (error) {
      throw new Error(
        `[sync] ${entry.templateId} v${version} :: insert failed: ${formatError(error)}`
      );
    }
    logger.info(
      `[sync] ${entry.templateId} v${version} :: inserted (hash ${contentHash.slice(0, 12)})`
    );
    inserts += 1;
  }

  logger.info(
    `[sync] summary :: inserts=${inserts}, unchanged=${unchanged}, mismatches=${mismatches}`
  );

  if (mismatches > 0) {
    throw new Error(
      "[sync] FAILURE :: HASH MISMATCH results indicate templates were modified without bumping the version comment."
    );
  }

  return {
    validated: sources.length,
    remoteAction: "synchronized",
    remoteReason: "database_sync_required",
    inserts,
    unchanged,
    mismatches,
  };
}
