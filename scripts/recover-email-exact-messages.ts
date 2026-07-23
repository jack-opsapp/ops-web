#!/usr/bin/env tsx

/**
 * Exact-message recovery runner.
 *
 * Dry-run is the default. Apply requires the SHA-256 of the complete manifest.
 * The provider surface is deliberately narrowed to fetchThread, and recovery
 * never advances a mailbox cursor or performs a mailbox mutation.
 *
 * Run:
 *   node --conditions=react-server --import tsx \
 *     scripts/recover-email-exact-messages.ts \
 *     --manifest /absolute/path/to/exact-recovery.json
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildEmailExactMessageRecoverySnapshotHash,
  createEmailExactMessageRecoverySnapshotProvider,
} from "../src/lib/api/services/email-exact-message-recovery-snapshot";
import {
  buildEmailExactMessageRecoveryManifestHash,
  runEmailExactMessageRecovery,
  supersedeUnstartedEmailExactMessageRecoveryWork,
  SupabaseEmailExactMessageRecoveryStore,
  type EmailExactMessageRecoveryManifest,
  type EmailExactMessageRecoveryReparentRepairInput,
} from "../src/lib/api/services/email-exact-message-recovery-service";
import type { NormalizedEmail } from "../src/lib/api/services/email-provider";

export interface EmailExactMessageRecoveryCliArgs {
  manifestPath: string;
  apply: boolean;
  approvedManifestSha256: string | null;
  supersedePriorManifestPath: string | null;
  supersedeProviderMessageIds: string[];
  providerSnapshotStdin: boolean;
  approvedProviderSnapshotSha256: string | null;
  json: boolean;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_PROVIDER_SNAPSHOT_STDIN_BYTES = 64 * 1024 * 1024;

export {
  buildEmailExactMessageRecoverySnapshotHash,
  createEmailExactMessageRecoverySnapshotProvider,
};

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

export function requireEmailExactMessageRecoveryReactServerRuntime(
  execArgv: string[] = process.execArgv,
  nodeOptions: string | undefined = process.env.NODE_OPTIONS
): void {
  if (configuredNodeConditions(execArgv, nodeOptions).has("react-server")) {
    return;
  }
  throw new Error(
    "Exact recovery requires the react-server module condition. Run: node --conditions=react-server --import tsx scripts/recover-email-exact-messages.ts --manifest <path>"
  );
}

interface InboxAuthorizationClient {
  rpc(
    functionName: string,
    parameters: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

interface ExactRecoveryEventQuery {
  select(columns: string): ExactRecoveryEventQuery;
  eq(column: string, value: unknown): ExactRecoveryEventQuery;
  limit(count: number): PromiseLike<{
    data: Array<Record<string, unknown>> | null;
    error: { message?: string } | null;
  }>;
}

interface ExactRecoveryEventClient {
  from(table: string): ExactRecoveryEventQuery;
}

export async function requireExactRecoveryCorrespondenceEvent(input: {
  client: ExactRecoveryEventClient;
  companyId: string;
  opportunityId: string;
  connectionId: string;
  activityId: string;
  providerThreadId: string;
  providerMessageId: string;
  expectedEventId: string | null;
}): Promise<string> {
  let query = input.client
    .from("opportunity_correspondence_events")
    .select(
      "id,company_id,opportunity_id,connection_id,activity_id,provider_thread_id,provider_message_id,direction,party_role,is_meaningful,opportunity_projection_applied"
    )
    .eq("company_id", input.companyId)
    .eq("opportunity_id", input.opportunityId)
    .eq("connection_id", input.connectionId)
    .eq("activity_id", input.activityId)
    .eq("provider_thread_id", input.providerThreadId)
    .eq("provider_message_id", input.providerMessageId)
    .eq("direction", "inbound")
    .eq("party_role", "customer")
    .eq("is_meaningful", true)
    .eq("opportunity_projection_applied", true);
  if (input.expectedEventId) {
    query = query.eq("id", input.expectedEventId);
  }

  const { data, error } = await query.limit(2);
  if (error) {
    throw new Error(
      `Exact recovery correspondence event lookup failed: ${error.message ?? "unknown error"}`
    );
  }
  if (!data || data.length !== 1) {
    throw new Error(
      "Exact recovery correspondence event was not found uniquely"
    );
  }
  const row = data[0];
  if (
    typeof row.id !== "string" ||
    row.company_id !== input.companyId ||
    row.opportunity_id !== input.opportunityId ||
    row.connection_id !== input.connectionId ||
    row.activity_id !== input.activityId ||
    row.provider_thread_id !== input.providerThreadId ||
    row.provider_message_id !== input.providerMessageId ||
    row.direction !== "inbound" ||
    row.party_role !== "customer" ||
    row.is_meaningful !== true ||
    row.opportunity_projection_applied !== true ||
    (input.expectedEventId !== null && row.id !== input.expectedEventId)
  ) {
    throw new Error("Exact recovery correspondence event identity changed");
  }
  return row.id;
}

export async function authorizeEmailExactMessageRecovery(input: {
  client: InboxAuthorizationClient;
  actorUserId: string;
  connectionId: string;
}): Promise<void> {
  const { data, error } = await input.client.rpc(
    "authorize_email_inbox_action_as_system",
    {
      p_actor_user_id: input.actorUserId,
      p_connection_id: input.connectionId,
      p_opportunity_id: null,
      p_action: "view",
    }
  );
  if (error || data !== true) {
    throw new Error("Actor cannot view this recovery mailbox");
  }
}

export async function authorizeEmailExactMessageIngest(input: {
  client: InboxAuthorizationClient;
  actorUserId: string;
  companyId: string;
  connectionId: string;
}): Promise<void> {
  const { data, error } = await input.client.rpc(
    "authorize_email_exact_message_ingest_as_system",
    {
      p_actor_user_id: input.actorUserId,
      p_company_id: input.companyId,
      p_connection_id: input.connectionId,
    }
  );
  if (error || data !== true) {
    throw new Error("Actor cannot ingest exact recovery messages");
  }
}

function nextValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseEmailExactMessageRecoveryCliArgs(
  argv: string[]
): EmailExactMessageRecoveryCliArgs {
  let manifestPath: string | null = null;
  let apply = false;
  let approvedManifestSha256: string | null = null;
  let supersedePriorManifestPath: string | null = null;
  const supersedeProviderMessageIds: string[] = [];
  let providerSnapshotStdin = false;
  let approvedProviderSnapshotSha256: string | null = null;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
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
      case "--supersede-prior-manifest":
        supersedePriorManifestPath = nextValue(argv, index, argument);
        index += 1;
        break;
      case "--supersede-provider-message-id":
        supersedeProviderMessageIds.push(nextValue(argv, index, argument));
        index += 1;
        break;
      case "--provider-snapshot-stdin":
        providerSnapshotStdin = true;
        break;
      case "--approve-provider-snapshot-sha256":
        approvedProviderSnapshotSha256 = nextValue(argv, index, argument);
        index += 1;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!manifestPath) throw new Error("--manifest is required");
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
  if (
    approvedProviderSnapshotSha256 &&
    !SHA256_PATTERN.test(approvedProviderSnapshotSha256)
  ) {
    throw new Error(
      "--approve-provider-snapshot-sha256 must be 64 lowercase hexadecimal characters"
    );
  }
  if (apply && providerSnapshotStdin && !approvedProviderSnapshotSha256) {
    throw new Error(
      "--apply with --provider-snapshot-stdin requires --approve-provider-snapshot-sha256"
    );
  }
  if (approvedProviderSnapshotSha256 && (!apply || !providerSnapshotStdin)) {
    throw new Error(
      "--approve-provider-snapshot-sha256 requires --apply with --provider-snapshot-stdin"
    );
  }
  if (
    (supersedePriorManifestPath || supersedeProviderMessageIds.length > 0) &&
    !apply
  ) {
    throw new Error("reviewed supersession requires --apply");
  }
  if (
    Boolean(supersedePriorManifestPath) !==
    supersedeProviderMessageIds.length > 0
  ) {
    throw new Error(
      "reviewed supersession requires both --supersede-prior-manifest and --supersede-provider-message-id"
    );
  }
  if (
    new Set(supersedeProviderMessageIds).size !==
    supersedeProviderMessageIds.length
  ) {
    throw new Error("--supersede-provider-message-id must be unique");
  }
  if (supersedeProviderMessageIds.length > 1) {
    throw new Error(
      "reviewed supersession supports exactly one provider message per invocation"
    );
  }

  return {
    manifestPath,
    apply,
    approvedManifestSha256,
    supersedePriorManifestPath,
    supersedeProviderMessageIds,
    providerSnapshotStdin,
    approvedProviderSnapshotSha256,
    json,
  };
}

function parseManifest(raw: string): EmailExactMessageRecoveryManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Manifest is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Manifest must be a JSON object");
  }
  return parsed as EmailExactMessageRecoveryManifest;
}

async function readProviderSnapshotFromStdin(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_PROVIDER_SNAPSHOT_STDIN_BYTES) {
      throw new Error("Provider snapshot stdin must be bounded JSON");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    throw new Error("--provider-snapshot-stdin received no JSON object");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Provider snapshot stdin is not valid JSON");
  }
}

export async function runEmailExactMessageRecoveryCli(
  argv: string[]
): Promise<void> {
  requireEmailExactMessageRecoveryReactServerRuntime();
  const args = parseEmailExactMessageRecoveryCliArgs(argv);
  const manifest = parseManifest(await readFile(args.manifestPath, "utf8"));
  const priorManifest = args.supersedePriorManifestPath
    ? parseManifest(await readFile(args.supersedePriorManifestPath, "utf8"))
    : null;
  const providerSnapshot = args.providerSnapshotStdin
    ? await readProviderSnapshotFromStdin()
    : null;
  const snapshotProvider =
    providerSnapshot === null
      ? null
      : createEmailExactMessageRecoverySnapshotProvider(
          providerSnapshot,
          manifest
        );
  const providerSnapshotSha256 =
    providerSnapshot === null
      ? null
      : buildEmailExactMessageRecoverySnapshotHash(providerSnapshot);
  if (
    args.apply &&
    args.approvedManifestSha256 !==
      buildEmailExactMessageRecoveryManifestHash(manifest)
  ) {
    throw new Error("Approved manifest SHA-256 does not match");
  }
  if (
    args.apply &&
    providerSnapshotSha256 !== null &&
    args.approvedProviderSnapshotSha256 !== providerSnapshotSha256
  ) {
    throw new Error("Approved provider snapshot SHA-256 does not match");
  }

  const { loadEnvConfig } = await import("@next/env");
  loadEnvConfig(process.env.OPS_WEB_ENV_DIR || process.cwd());

  const [
    { EmailService },
    { SyncEngine },
    { projectApprovedUnansweredLeadRecoveryMessage },
    { getAdminSupabase },
    { runWithSupabase },
  ] = await Promise.all([
    import("../src/lib/api/services/email-service"),
    import("../src/lib/api/services/sync-engine"),
    import("../src/lib/api/services/unanswered-lead-local-draft-backfill-dependencies"),
    import("../src/lib/supabase/admin-client"),
    import("../src/lib/supabase/helpers"),
  ]);
  const recoverySyncEngine = SyncEngine as unknown as typeof SyncEngine & {
    repairExactReparentedMessageForRecovery?: (
      input: EmailExactMessageRecoveryReparentRepairInput
    ) => Promise<void>;
  };
  const supabase = getAdminSupabase();

  const result = await runWithSupabase(supabase, async () => {
    const connection = await EmailService.getConnection(manifest.connectionId);
    if (!connection || connection.status !== "active") {
      throw new Error("Recovery mailbox is not active");
    }
    if (connection.companyId !== manifest.companyId) {
      throw new Error("Recovery mailbox belongs to another company");
    }

    await authorizeEmailExactMessageRecovery({
      client: supabase as unknown as InboxAuthorizationClient,
      actorUserId: manifest.actorUserId,
      connectionId: manifest.connectionId,
    });
    if (
      args.apply &&
      manifest.entries.some(
        (entry) =>
          entry.action === "ingest" ||
          entry.action === "create_target_and_reparent"
      )
    ) {
      await authorizeEmailExactMessageIngest({
        client: supabase as unknown as InboxAuthorizationClient,
        actorUserId: manifest.actorUserId,
        companyId: manifest.companyId,
        connectionId: manifest.connectionId,
      });
    }

    const store = new SupabaseEmailExactMessageRecoveryStore(supabase);
    const provider =
      snapshotProvider ??
      (() => {
        const fullProvider = EmailService.getProvider(connection);
        return {
          fetchThread: (
            threadId: string,
            readPolicy?: Parameters<typeof fullProvider.fetchThread>[1]
          ) => fullProvider.fetchThread(threadId, readPolicy),
        };
      })();

    if (priorManifest) {
      await supersedeUnstartedEmailExactMessageRecoveryWork({
        priorManifest,
        supersedingManifest: manifest,
        providerMessageIds: args.supersedeProviderMessageIds,
        approvedSupersedingManifestSha256: args.approvedManifestSha256!,
        store,
      });
    }

    const repairExactReparentedMessage =
      recoverySyncEngine.repairExactReparentedMessageForRecovery;
    return runEmailExactMessageRecovery({
      manifest,
      apply: args.apply,
      approvedManifestSha256: args.approvedManifestSha256,
      provider,
      store,
      repairReparentedMessage: repairExactReparentedMessage
        ? async (input) => repairExactReparentedMessage(input)
        : undefined,
      projectUnansweredDraft: async (input) => {
        const sourceEventId = await requireExactRecoveryCorrespondenceEvent({
          client: supabase as unknown as ExactRecoveryEventClient,
          companyId: input.companyId,
          opportunityId: input.opportunityId,
          connectionId: input.connectionId,
          activityId: input.activityId,
          providerThreadId: input.entry.providerThreadId,
          providerMessageId: input.entry.providerMessageId,
          expectedEventId: input.correspondenceEventId,
        });
        await projectApprovedUnansweredLeadRecoveryMessage(
          {
            actorUserId: input.actorUserId,
            companyId: input.companyId,
            opportunityId: input.opportunityId,
            connectionId: input.connectionId,
            sourceEventId,
            sourceActivityId: input.activityId,
            sourceProviderThreadId: input.entry.providerThreadId,
            sourceProviderMessageId: input.entry.providerMessageId,
            workstream: input.projection.workstream,
            responseDisposition: input.projection.responseDisposition,
            conversationScope: input.projection.conversationScope,
            approvedManifestSha256: input.manifestSha256,
            entrySha256: input.entrySha256,
          },
          { supabase: supabase as never }
        );
      },
      ingestExactMessage: async ({
        actorUserId,
        companyId,
        connectionId,
        message,
      }) => {
        const ingestWithActor =
          SyncEngine.ingestExactInboundMessageForRecovery as (input: {
            actorUserId: string;
            companyId: string;
            connectionId: string;
            email: NormalizedEmail;
          }) => ReturnType<
            typeof SyncEngine.ingestExactInboundMessageForRecovery
          >;
        const ingestion = await ingestWithActor({
          actorUserId,
          companyId,
          connectionId,
          email: message,
        });
        if (ingestion.errors.length > 0) {
          throw new Error(
            `Exact-message ingestion failed: ${ingestion.errors.join("; ")}`
          );
        }
        const activity = await store.findExactActivity({
          companyId: manifest.companyId,
          connectionId,
          providerThreadId: message.threadId,
          providerMessageId: message.id,
        });
        if (!activity?.opportunityId) {
          throw new Error(
            "Exact-message ingestion did not persist a lead activity"
          );
        }
        return {
          applied: ingestion.activitiesCreated > 0,
          alreadyApplied: ingestion.activitiesCreated === 0,
          activityId: activity.activityId,
          opportunityId: activity.opportunityId,
        };
      },
    });
  });

  const renderedResult =
    providerSnapshotSha256 === null
      ? result
      : { ...result, providerSnapshotSha256 };
  if (!args.json) {
    process.stdout.write(
      `${result.mode === "apply" ? "Apply" : "Dry-run"}: ${result.entries.length} exact message${result.entries.length === 1 ? "" : "s"}\n`
    );
    process.stdout.write(`Manifest: ${result.manifestSha256}\n`);
    if (providerSnapshotSha256 !== null) {
      process.stdout.write(`Provider snapshot: ${providerSnapshotSha256}\n`);
    }
  }
  process.stdout.write(`${JSON.stringify(renderedResult, null, 2)}\n`);
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  runEmailExactMessageRecoveryCli(process.argv.slice(2)).catch((error) => {
    console.error(
      "[exact-message-recovery] Failed:",
      error instanceof Error ? error.message : "Unknown error"
    );
    process.exitCode = 1;
  });
}
