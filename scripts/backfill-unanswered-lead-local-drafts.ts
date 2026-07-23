#!/usr/bin/env tsx

/**
 * Approval-gated OPS-local unanswered-lead draft runner.
 *
 * Review mode can still evaluate a previously captured snapshot without any
 * live access. Production mode accepts only an exact content-addressed
 * manifest. It performs live database/auth rechecks and is dry-run by default;
 * apply can create only source-bound OPS-local system_handoff drafts through
 * the canonical persistence RPCs. This file has no mailbox transport.
 *
 * Offline review:
 *   npx tsx scripts/backfill-unanswered-lead-local-drafts.ts \
 *     --snapshot /absolute/path/to/snapshot.json \
 *     [--now 2026-07-22T17:30:00.000Z] \
 *     [--output /absolute/path/to/dry-run.json]
 *
 * Live recheck (read-only default):
 *   node --conditions=react-server --import tsx \
 *     scripts/backfill-unanswered-lead-local-drafts.ts \
 *     --manifest /absolute/path/to/approved-manifest.json
 *
 * Approval-gated local apply:
 *   node --conditions=react-server --import tsx \
 *     scripts/backfill-unanswered-lead-local-drafts.ts \
 *     --manifest /absolute/path/to/approved-manifest.json \
 *     --apply \
 *     --approve-manifest-sha256 <64-lowercase-hex>
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runApprovedUnansweredLeadLocalDraftBackfill,
  type ApprovedUnansweredLeadDraftManifest,
} from "../src/lib/api/services/unanswered-lead-local-draft-executor";
import {
  previousSevenVancouverCalendarDays,
  selectUnansweredLeadDraftCandidates,
  type UnansweredLeadOpportunitySnapshot,
} from "../src/lib/api/services/unanswered-lead-local-draft-backfill-service";

interface SnapshotDocument {
  companyId: string;
  capturedAt: string;
  opportunities: UnansweredLeadOpportunitySnapshot[];
}

export interface UnansweredLeadLocalDraftCliArgs {
  snapshotPath: string | null;
  manifestPath: string | null;
  apply: boolean;
  approvedManifestSha256: string | null;
  outputPath: string | null;
  now: string | null;
  json: boolean;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function nextValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseUnansweredLeadLocalDraftCliArgs(
  argv: string[]
): UnansweredLeadLocalDraftCliArgs {
  let snapshotPath: string | null = null;
  let manifestPath: string | null = null;
  let apply = false;
  let approvedManifestSha256: string | null = null;
  let outputPath: string | null = null;
  let now: string | null = null;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--snapshot":
        snapshotPath = nextValue(argv, index, argument);
        index += 1;
        break;
      case "--manifest":
        manifestPath = nextValue(argv, index, argument);
        index += 1;
        break;
      case "--apply":
        apply = true;
        break;
      case "--approve-manifest-sha256":
        approvedManifestSha256 = nextValue(argv, index, argument);
        index += 1;
        break;
      case "--output":
        outputPath = nextValue(argv, index, argument);
        index += 1;
        break;
      case "--now":
        now = nextValue(argv, index, argument);
        index += 1;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if ((snapshotPath === null) === (manifestPath === null)) {
    throw new Error("Exactly one of --snapshot or --manifest is required");
  }
  if (apply && !manifestPath) {
    throw new Error("--apply requires --manifest");
  }
  if (approvedManifestSha256 && !SHA256_PATTERN.test(approvedManifestSha256)) {
    throw new Error(
      "--approve-manifest-sha256 must be 64 lowercase hexadecimal characters"
    );
  }
  if (apply && !approvedManifestSha256) {
    throw new Error("--apply requires --approve-manifest-sha256");
  }
  if (!apply && approvedManifestSha256) {
    throw new Error("--approve-manifest-sha256 requires --apply");
  }
  if (manifestPath && now) {
    throw new Error("--now is allowed only with offline --snapshot review");
  }

  return {
    snapshotPath,
    manifestPath,
    apply,
    approvedManifestSha256,
    outputPath,
    now,
    json,
  };
}

function configuredNodeConditions(
  execArgv: string[],
  nodeOptions: string | undefined
): Set<string> {
  const conditions = new Set<string>();
  const collect = (value: string): void => {
    for (const condition of value.split(",")) {
      const normalized = condition.trim();
      if (normalized) conditions.add(normalized);
    }
  };

  for (let index = 0; index < execArgv.length; index += 1) {
    const argument = execArgv[index]!;
    if (argument === "--conditions" || argument === "-C") {
      const value = execArgv[index + 1];
      if (value) collect(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--conditions=")) {
      collect(argument.slice("--conditions=".length));
    } else if (argument.startsWith("-C=")) {
      collect(argument.slice(3));
    }
  }

  for (const match of nodeOptions?.matchAll(
    /(?:^|\s)(?:--conditions|-C)(?:=|\s+)([^\s]+)/g
  ) ?? []) {
    if (match[1]) collect(match[1]);
  }
  return conditions;
}

export function requireUnansweredLeadReactServerRuntime(
  execArgv: string[] = process.execArgv,
  nodeOptions: string | undefined = process.env.NODE_OPTIONS
): void {
  if (configuredNodeConditions(execArgv, nodeOptions).has("react-server")) {
    return;
  }
  throw new Error(
    "Live manifest mode requires the react-server module condition. Run: node --conditions=react-server --import tsx scripts/backfill-unanswered-lead-local-drafts.ts --manifest <path>"
  );
}

function requiredText(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function parseSnapshot(raw: string): SnapshotDocument {
  const parsed = parseJsonObject(raw, "Snapshot");
  if (!Array.isArray(parsed.opportunities)) {
    throw new Error("Snapshot opportunities must be an array");
  }
  return {
    companyId: requiredText(parsed.companyId, "Snapshot companyId"),
    capturedAt: requiredText(parsed.capturedAt, "Snapshot capturedAt"),
    opportunities: parsed.opportunities as UnansweredLeadOpportunitySnapshot[],
  };
}

function parseManifest(raw: string): ApprovedUnansweredLeadDraftManifest {
  return parseJsonObject(
    raw,
    "Manifest"
  ) as unknown as ApprovedUnansweredLeadDraftManifest;
}

async function renderResult(
  result: Record<string, unknown>,
  outputPath: string | null
): Promise<void> {
  const rendered = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, rendered, "utf8");
  else process.stdout.write(rendered);
}

async function runOfflineSnapshotReview(
  args: UnansweredLeadLocalDraftCliArgs
): Promise<Record<string, unknown>> {
  const now = args.now ? new Date(args.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error("--now must be an ISO time");
  const snapshot = parseSnapshot(await readFile(args.snapshotPath!, "utf8"));
  const plan = selectUnansweredLeadDraftCandidates(
    snapshot.opportunities,
    previousSevenVancouverCalendarDays(now),
    snapshot.companyId
  );
  return {
    mode: "dry-run",
    safety: {
      liveReads: false,
      liveWrites: false,
      mailboxWrites: false,
      copyGeneration: false,
    },
    companyId: snapshot.companyId,
    snapshotCapturedAt: snapshot.capturedAt,
    evaluatedAt: now.toISOString(),
    window: {
      timeZone: plan.window.timeZone,
      startInclusive: plan.window.startInclusive.toISOString(),
      endInclusive: plan.window.endInclusive.toISOString(),
    },
    candidates: plan.candidates.map((candidate) => ({
      opportunityId: candidate.opportunityId,
      label: candidate.label,
      recipientEmail: candidate.recipientEmail,
      sourceConnectionId: candidate.sourceConnectionId,
      sourceEventId: candidate.sourceEventId,
      sourceActivityId: candidate.sourceActivityId,
      sourceProviderMessageId: candidate.sourceProviderMessageId,
      sourceProviderThreadId: candidate.sourceProviderThreadId,
      sourceOccurredAt: candidate.sourceOccurredAt,
      replyMode: candidate.providerThreadId ? "reply" : "new_thread",
      expectedStage: candidate.expectedStage,
      expectedStageManuallySet: candidate.expectedStageManuallySet,
      expectedAssignmentVersion: candidate.expectedAssignmentVersion,
      expectedAssignedTo: candidate.expectedAssignedTo,
      expectedWorkstream: candidate.expectedWorkstream,
    })),
    excluded: plan.excluded,
  };
}

async function runLiveManifest(
  args: UnansweredLeadLocalDraftCliArgs
): Promise<Record<string, unknown>> {
  requireUnansweredLeadReactServerRuntime();
  const manifest = parseManifest(await readFile(args.manifestPath!, "utf8"));
  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.env.OPS_WEB_ENV_DIR || process.cwd());
  const [
    { createUnansweredLeadLocalDraftBackfillDependencies },
    { getAdminSupabase },
    { runWithSupabase },
  ] = await Promise.all([
    import("../src/lib/api/services/unanswered-lead-local-draft-backfill-dependencies"),
    import("../src/lib/supabase/admin-client"),
    import("../src/lib/supabase/helpers"),
  ]);
  const supabase = getAdminSupabase();

  const result = await runWithSupabase(supabase, async () =>
    runApprovedUnansweredLeadLocalDraftBackfill({
      manifest,
      dependencies: createUnansweredLeadLocalDraftBackfillDependencies({
        supabase: supabase as never,
      }),
      apply: args.apply,
      approvedManifestSha256: args.approvedManifestSha256,
    })
  );
  return { ...result };
}

export async function runUnansweredLeadLocalDraftCli(
  argv: string[]
): Promise<void> {
  const args = parseUnansweredLeadLocalDraftCliArgs(argv);
  const result = args.snapshotPath
    ? await runOfflineSnapshotReview(args)
    : await runLiveManifest(args);

  if (!args.json) {
    const entries = Array.isArray(result.entries)
      ? result.entries.length
      : Array.isArray(result.candidates)
        ? result.candidates.length
        : 0;
    process.stdout.write(
      `${result.mode === "apply" ? "Apply" : "Dry-run"}: ${entries} approved local draft entr${entries === 1 ? "y" : "ies"}\n`
    );
    if (typeof result.manifestSha256 === "string") {
      process.stdout.write(`Manifest: ${result.manifestSha256}\n`);
    }
  }
  await renderResult(result, args.outputPath);
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  runUnansweredLeadLocalDraftCli(process.argv.slice(2)).catch((error) => {
    console.error(
      "[unanswered-lead-local-draft-backfill] Failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    process.exitCode = 1;
  });
}
