/**
 * OPS Web — Automated resolution of quarantined provider mutations
 *
 * `EmailProviderMutationAttemptService` quarantines any attempt whose outcome
 * it cannot prove, and `prepare_email_provider_mutation_attempt` then hands that
 * same row to every later caller on the same
 * (connection_id_snapshot, operation_kind, operation_key). Until 2026-08-06
 * nothing could clear it, so a single quarantine blocked its operation forever
 * and recovery meant a hand-written UPDATE against production.
 *
 * This is that recovery, automated — and held to the exact standard the manual
 * pass used: nothing leaves quarantine without the provider being asked
 * directly. Absence of evidence resolves nothing.
 *
 * Two shapes of quarantined attempt exist, and they admit different evidence:
 *
 *   - The ledger recorded a provider resource id. `getDraft` on that immutable
 *     id settles the question in either direction, because the identity is
 *     ours: present means the mutation landed, gone means it did not survive.
 *
 *   - The ledger recorded nothing. This is the outage shape — the sync-terminal
 *     fence threw inside `executeProvider` before Gmail was ever called, so
 *     there is no id to ask about. Only a per-thread probe can speak here, and
 *     it can only ever prove ABSENCE: a draft sitting on the thread proves that
 *     *a* draft exists, not that it is ours, and the operator composes on these
 *     threads too. Adopting one would hand OPS ownership of the operator's
 *     unsent reply, which reconciliation would later overwrite or delete.
 *
 * Never throws. A sync must never fail because recovery could not run.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailConnection } from "@/lib/types/email-connection";
import { EmailService } from "./email-service";
import type { ProviderReadPolicy } from "./email-provider";
import { runEmailProviderMailboxOperation } from "./email-provider-mailbox-operation";
import {
  SupabaseEmailProviderMutationAttemptStore,
  type EmailProviderMutationResolutionVerdict,
} from "./email-provider-mutation-attempt-service";
import type { EmailProviderMailboxCheckpoint } from "./email-provider-mailbox-operation";

/** Operation keys that name their own `ai_draft_history` row. */
const PHASE_C_REPLY_DRAFT_KEY_PREFIX = "phase-c-reply-draft:";

/** Attempts examined per connection per cycle. */
export const RECONCILIATION_RESOLVER_ATTEMPT_LIMIT = 25;
/**
 * How far back a quarantine stays eligible for automated resolution. Past this
 * the mailbox has moved on far enough that an operator should look, and the
 * persistent notification is the surface for that.
 */
export const RECONCILIATION_RESOLVER_WINDOW_DAYS = 30;
export const RECONCILIATION_RESOLVER_DEADLINE_MS = 60 * 1000;

export interface ReconciliationResolutionSummary {
  /** Quarantined attempts examined. */
  scanned: number;
  /** Proven to exist and handed back to the normal completion path. */
  accepted: number;
  /** Proven absent and released for a fresh attempt. */
  rejected: number;
  /** No admissible evidence available; left quarantined on purpose. */
  unresolved: number;
  /** A provider read or ledger write failed; retried next cycle. */
  failed: number;
}

interface QuarantinedAttempt {
  id: string;
  operationKey: string;
  providerResourceId: string | null;
}

interface ResolutionPlan {
  attempt: QuarantinedAttempt;
  /** Provider thread to probe when the ledger holds no resource identity. */
  providerThreadId: string | null;
}

type Verdict = {
  attemptId: string;
  verdict: EmailProviderMutationResolutionVerdict;
  providerResourceId: string | null;
  evidence: string;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Locate the conversation a Phase C reply-draft attempt was aimed at. The
 * operation key names the `ai_draft_history` row, which is the only handle the
 * ledger carries back to a thread.
 */
async function resolveProviderThreadId(input: {
  supabase: SupabaseClient;
  connection: EmailConnection;
  operationKey: string;
}): Promise<string | null> {
  if (!input.operationKey.startsWith(PHASE_C_REPLY_DRAFT_KEY_PREFIX)) {
    return null;
  }
  const draftHistoryId = input.operationKey
    .slice(PHASE_C_REPLY_DRAFT_KEY_PREFIX.length)
    .trim();
  if (!draftHistoryId) return null;

  const { data, error } = await input.supabase
    .from("ai_draft_history")
    .select("id, thread_id")
    .eq("company_id", input.connection.companyId)
    .eq("connection_id", input.connection.id)
    .eq("id", draftHistoryId)
    .maybeSingle();
  if (error) throw error;
  return text((data as Record<string, unknown> | null)?.thread_id);
}

/**
 * Ask the provider what really happened to one quarantined mutation.
 *
 * Returns null when nothing admissible can be established — the attempt stays
 * quarantined, which is the correct outcome, not a failure.
 */
async function probeAttempt(input: {
  plan: ResolutionPlan;
  provider: ReturnType<typeof EmailService.getProvider>;
  readPolicy: ProviderReadPolicy;
}): Promise<Verdict | null> {
  const { attempt, providerThreadId } = input.plan;

  if (attempt.providerResourceId) {
    const draft = await input.provider.getDraft(
      attempt.providerResourceId,
      input.readPolicy
    );
    return draft
      ? {
          attemptId: attempt.id,
          verdict: "resource_exists",
          providerResourceId: attempt.providerResourceId,
          evidence: `provider read: draft ${attempt.providerResourceId} is present`,
        }
      : {
          attemptId: attempt.id,
          verdict: "resource_absent",
          // Naming the identity is what licenses clearing it.
          providerResourceId: attempt.providerResourceId,
          evidence: `provider read: draft ${attempt.providerResourceId} no longer exists`,
        };
  }

  if (!providerThreadId) return null;

  const probe = await input.provider.findDraftsOnThread(
    providerThreadId,
    input.readPolicy
  );
  if (probe.present) {
    // Existence is proven; ownership is not. See the module header.
    return null;
  }
  return {
    attemptId: attempt.id,
    verdict: "resource_absent",
    providerResourceId: null,
    evidence: `provider read: no draft on thread ${providerThreadId}`,
  };
}

/**
 * Clear what can be cleared, for one connection, within a bounded budget.
 *
 * Runs outside the mailbox lease and takes its own, exactly like the router's
 * placement path — provider work for one physical mailbox stays serialized
 * against sync and import.
 */
export async function resolveEmailProviderMutationReconciliationForConnection(input: {
  connection: EmailConnection;
  supabase: SupabaseClient;
  providerLockCheckpoint?: EmailProviderMailboxCheckpoint;
}): Promise<ReconciliationResolutionSummary> {
  const summary: ReconciliationResolutionSummary = {
    scanned: 0,
    accepted: 0,
    rejected: 0,
    unresolved: 0,
    failed: 0,
  };

  try {
    const cutoff = new Date(
      Date.now() - RECONCILIATION_RESOLVER_WINDOW_DAYS * 86_400_000
    ).toISOString();
    // The ledger grants service_role nothing — it is reachable only through
    // SECURITY DEFINER RPCs, reads included. A direct PostgREST select here is
    // permission denied, which is how this sweep failed on every production
    // cycle before it scanned a single row.
    const { data, error } = await input.supabase.rpc(
      "list_email_provider_mutation_reconciliation_candidates",
      {
        p_connection_id: input.connection.id,
        p_operation_kind: "draft_create",
        p_since: cutoff,
        p_limit: RECONCILIATION_RESOLVER_ATTEMPT_LIMIT,
      }
    );
    if (error) throw error;

    const attempts: QuarantinedAttempt[] = (
      (data ?? []) as Array<Record<string, unknown>>
    )
      .map((row) => ({
        id: text(row.id) ?? "",
        operationKey: text(row.operation_key) ?? "",
        providerResourceId: text(row.provider_resource_id),
      }))
      .filter((attempt) => attempt.id);
    // Cheap first: a healthy mailbox never reaches the provider from here.
    if (attempts.length === 0) return summary;

    const plans: ResolutionPlan[] = [];
    for (const attempt of attempts) {
      summary.scanned += 1;
      try {
        plans.push({
          attempt,
          providerThreadId: attempt.providerResourceId
            ? null
            : await resolveProviderThreadId({
                supabase: input.supabase,
                connection: input.connection,
                operationKey: attempt.operationKey,
              }),
        });
      } catch (planError) {
        summary.failed += 1;
        console.warn(
          `[mutation-reconciliation] could not locate the target of attempt ${attempt.id}`,
          planError
        );
      }
    }

    const verdicts: Verdict[] = [];
    await runEmailProviderMailboxOperation({
      supabase: input.supabase,
      connectionId: input.connection.id,
      context: "email-provider-mutation-reconciliation",
      busyError: "MUTATION_RECONCILIATION_MAILBOX_BUSY",
      providerLockCheckpoint: input.providerLockCheckpoint,
      run: async (checkpoint) => {
        const provider = EmailService.getProvider(input.connection);
        const readPolicy: ProviderReadPolicy = {
          deadlineAt: Date.now() + RECONCILIATION_RESOLVER_DEADLINE_MS,
          context: "provider mutation reconciliation",
        };
        for (const plan of plans) {
          await checkpoint();
          try {
            const verdict = await probeAttempt({ plan, provider, readPolicy });
            if (verdict) {
              verdicts.push(verdict);
            } else {
              summary.unresolved += 1;
            }
          } catch (probeError) {
            // A failed read is not a finding. The attempt stays quarantined.
            summary.failed += 1;
            console.warn(
              `[mutation-reconciliation] provider read failed for attempt ${plan.attempt.id}`,
              probeError
            );
          }
        }
      },
    });

    const store = new SupabaseEmailProviderMutationAttemptStore(input.supabase);
    for (const verdict of verdicts) {
      try {
        await store.resolveReconciliation({
          attemptId: verdict.attemptId,
          verdict: verdict.verdict,
          providerResourceId: verdict.providerResourceId,
          evidence: verdict.evidence,
        });
        if (verdict.verdict === "resource_exists") summary.accepted += 1;
        else summary.rejected += 1;
      } catch (writeError) {
        summary.failed += 1;
        console.warn(
          `[mutation-reconciliation] could not record the verdict for attempt ${verdict.attemptId}`,
          writeError
        );
      }
    }

    return summary;
  } catch (error) {
    summary.failed += 1;
    console.warn(
      `[mutation-reconciliation] resolution sweep failed for connection ${input.connection.id}`,
      error
    );
    return summary;
  }
}
