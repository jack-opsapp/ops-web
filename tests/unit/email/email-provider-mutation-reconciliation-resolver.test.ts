/**
 * Unit tests — automated resolution of quarantined provider mutations
 *
 * The manual recovery on 2026-08-06 held itself to one rule: nothing left
 * `reconciliation_required` until the Gmail API had been asked directly whether
 * the draft was there. This resolver automates that rule and nothing looser.
 *
 * Two shapes of quarantined attempt exist, and they admit different evidence:
 *   - the ledger recorded a provider resource id → `getDraft` on that exact id
 *     settles it in either direction, because the identity is ours.
 *   - the ledger recorded nothing (the outage shape: the fence threw before the
 *     provider was ever reached) → only a per-thread probe can speak, and it can
 *     only ever prove ABSENCE. A draft sitting on the thread might be the
 *     operator's own composition, so it never licenses an acceptance.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDraftMock, findDraftsOnThreadMock } = vi.hoisted(() => ({
  getDraftMock: vi.fn(),
  findDraftsOnThreadMock: vi.fn(),
}));

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getProvider: () => ({
      getDraft: getDraftMock,
      findDraftsOnThread: findDraftsOnThreadMock,
    }),
  },
}));

vi.mock("@/lib/api/services/email-provider-mailbox-operation", () => ({
  runEmailProviderMailboxOperation: async (input: {
    providerLockCheckpoint?: (force?: boolean) => Promise<void>;
    run: (checkpoint: (force?: boolean) => Promise<void>) => Promise<unknown>;
  }) => input.run(input.providerLockCheckpoint ?? (async () => {})),
}));

import { resolveEmailProviderMutationReconciliationForConnection } from "@/lib/api/services/email-provider-mutation-reconciliation-resolver";

const CONNECTION = {
  id: "connection-1",
  companyId: "company-1",
  email: "operator@example.com",
} as never;

interface AttemptRow {
  id: string;
  operation_kind?: string;
  operation_key: string;
  provider_resource_id?: string | null;
  reconciliation_required_at?: string;
  last_error?: string | null;
}

interface HistoryRow {
  id: string;
  thread_id: string | null;
}

function resolverSupabase(input: {
  attempts: AttemptRow[];
  histories?: HistoryRow[];
  rpcError?: (args: Record<string, unknown>) => { message: string } | null;
}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const attemptRows = input.attempts.map((row) => ({
    operation_kind: "draft_create",
    provider_resource_id: null,
    reconciliation_required_at: "2026-08-06T16:00:00.000Z",
    last_error: "quarantined",
    ...row,
  }));

  const builder = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "gte", "not", "order"]) {
      chain[method] = () => chain;
    }
    chain.limit = async () => ({ data: rows, error: null });
    chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    return chain;
  };

  return {
    rpcCalls,
    supabase: {
      from: (table: string) => {
        // Production grants service_role NOTHING on this table — it is
        // definer-RPC-only by design. A direct read here is permission denied,
        // which is exactly the failure that shipped and then showed up as
        // reconciliation.failed on every production cycle.
        if (table === "email_provider_mutation_attempts") {
          throw new Error(
            "permission denied for table email_provider_mutation_attempts"
          );
        }
        return builder(input.histories ?? []);
      },
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        // Listing candidates is how the resolver is allowed to read the ledger
        // at all; `rpcCalls` stays a record of the verdicts it actually issued.
        if (name === "list_email_provider_mutation_reconciliation_candidates") {
          return { data: attemptRows, error: null };
        }
        rpcCalls.push({ name, args });
        const error = input.rpcError?.(args) ?? null;
        return { data: error ? null : [{ id: args.p_attempt_id }], error };
      }),
    } as never,
  };
}

describe("resolveEmailProviderMutationReconciliationForConnection", () => {
  beforeEach(() => {
    getDraftMock.mockReset();
    findDraftsOnThreadMock.mockReset();
  });

  it("touches no provider when nothing is quarantined", async () => {
    const { supabase, rpcCalls } = resolverSupabase({ attempts: [] });

    const summary = await resolveEmailProviderMutationReconciliationForConnection(
      { connection: CONNECTION, supabase }
    );

    expect(summary).toEqual({
      scanned: 0,
      accepted: 0,
      rejected: 0,
      unresolved: 0,
      failed: 0,
    });
    expect(getDraftMock).not.toHaveBeenCalled();
    expect(findDraftsOnThreadMock).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("accepts a recorded resource the provider still holds", async () => {
    getDraftMock.mockResolvedValue({ id: "r-77" });
    const { supabase, rpcCalls } = resolverSupabase({
      attempts: [
        {
          id: "attempt-1",
          operation_key: "phase-c-reply-draft:draft-1",
          provider_resource_id: "r-77",
        },
      ],
    });

    const summary = await resolveEmailProviderMutationReconciliationForConnection(
      { connection: CONNECTION, supabase }
    );

    expect(getDraftMock).toHaveBeenCalledWith("r-77", expect.anything());
    expect(summary).toMatchObject({ scanned: 1, accepted: 1, rejected: 0 });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe(
      "resolve_email_provider_mutation_reconciliation"
    );
    expect(rpcCalls[0].args).toMatchObject({
      p_attempt_id: "attempt-1",
      p_verdict: "resource_exists",
      p_provider_resource_id: "r-77",
    });
    expect(String(rpcCalls[0].args.p_evidence)).toContain("r-77");
  });

  it("rejects a recorded resource the provider says is gone, naming it", async () => {
    getDraftMock.mockResolvedValue(null);
    const { supabase, rpcCalls } = resolverSupabase({
      attempts: [
        {
          id: "attempt-1",
          operation_key: "phase-c-reply-draft:draft-1",
          provider_resource_id: "r-77",
        },
      ],
    });

    const summary = await resolveEmailProviderMutationReconciliationForConnection(
      { connection: CONNECTION, supabase }
    );

    expect(summary).toMatchObject({ scanned: 1, accepted: 0, rejected: 1 });
    expect(rpcCalls[0].args).toMatchObject({
      p_attempt_id: "attempt-1",
      p_verdict: "resource_absent",
      // Naming the disproven identity is what the RPC requires before it will
      // clear it — a blind absence claim is refused.
      p_provider_resource_id: "r-77",
    });
  });

  it("rejects an unrecorded mutation when its thread provably holds no draft", async () => {
    findDraftsOnThreadMock.mockResolvedValue({ present: false, draftIds: [] });
    const { supabase, rpcCalls } = resolverSupabase({
      attempts: [
        {
          id: "attempt-1",
          operation_key: "phase-c-reply-draft:draft-1",
          provider_resource_id: null,
        },
      ],
      histories: [{ id: "draft-1", thread_id: "thread-9" }],
    });

    const summary = await resolveEmailProviderMutationReconciliationForConnection(
      { connection: CONNECTION, supabase }
    );

    expect(findDraftsOnThreadMock).toHaveBeenCalledWith(
      "thread-9",
      expect.anything()
    );
    expect(getDraftMock).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ scanned: 1, rejected: 1, unresolved: 0 });
    expect(rpcCalls[0].args).toMatchObject({
      p_verdict: "resource_absent",
      p_provider_resource_id: null,
    });
    expect(String(rpcCalls[0].args.p_evidence)).toContain("thread-9");
  });

  it("never adopts a draft the ledger never minted", async () => {
    // A draft sitting on the thread proves *a* draft exists, not that it is
    // ours — the operator composes on these threads too. Claiming it would
    // hand OPS ownership of the operator's unsent reply, and reconciliation
    // would later overwrite or delete it.
    findDraftsOnThreadMock.mockResolvedValue({
      present: true,
      draftIds: ["r-unknown"],
    });
    const { supabase, rpcCalls } = resolverSupabase({
      attempts: [
        {
          id: "attempt-1",
          operation_key: "phase-c-reply-draft:draft-1",
          provider_resource_id: null,
        },
      ],
      histories: [{ id: "draft-1", thread_id: "thread-9" }],
    });

    const summary = await resolveEmailProviderMutationReconciliationForConnection(
      { connection: CONNECTION, supabase }
    );

    expect(summary).toMatchObject({ scanned: 1, unresolved: 1, rejected: 0 });
    expect(rpcCalls).toHaveLength(0);
  });

  it("leaves an unprobeable attempt alone", async () => {
    // No recorded identity and no thread handle in the operation key: there is
    // no question the provider can be asked, so nothing may be concluded.
    const { supabase, rpcCalls } = resolverSupabase({
      attempts: [
        {
          id: "attempt-1",
          operation_key: "inbox-composer:abc",
          provider_resource_id: null,
        },
      ],
    });

    const summary = await resolveEmailProviderMutationReconciliationForConnection(
      { connection: CONNECTION, supabase }
    );

    expect(summary).toMatchObject({ scanned: 1, unresolved: 1 });
    expect(findDraftsOnThreadMock).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it("treats a failed provider read as no evidence at all", async () => {
    findDraftsOnThreadMock.mockRejectedValue(new Error("gmail 503"));
    const { supabase, rpcCalls } = resolverSupabase({
      attempts: [
        {
          id: "attempt-1",
          operation_key: "phase-c-reply-draft:draft-1",
          provider_resource_id: null,
        },
      ],
      histories: [{ id: "draft-1", thread_id: "thread-9" }],
    });

    const summary = await resolveEmailProviderMutationReconciliationForConnection(
      { connection: CONNECTION, supabase }
    );

    expect(summary).toMatchObject({ scanned: 1, failed: 1, rejected: 0 });
    expect(rpcCalls).toHaveLength(0);
  });

  it("keeps going when one attempt cannot be written back", async () => {
    getDraftMock.mockResolvedValue({ id: "r-77" });
    const { supabase, rpcCalls } = resolverSupabase({
      attempts: [
        {
          id: "attempt-1",
          operation_key: "phase-c-reply-draft:draft-1",
          provider_resource_id: "r-77",
        },
        {
          id: "attempt-2",
          operation_key: "phase-c-reply-draft:draft-2",
          provider_resource_id: "r-78",
        },
      ],
      rpcError: (args) =>
        args.p_attempt_id === "attempt-1" ? { message: "deadlock" } : null,
    });

    const summary = await resolveEmailProviderMutationReconciliationForConnection(
      { connection: CONNECTION, supabase }
    );

    expect(summary).toMatchObject({ scanned: 2, accepted: 1, failed: 1 });
    expect(rpcCalls).toHaveLength(2);
  });

  it("never throws, so a sync can never fail because of it", async () => {
    const exploding = {
      from: () => {
        throw new Error("database unavailable");
      },
      rpc: vi.fn(),
    } as never;

    await expect(
      resolveEmailProviderMutationReconciliationForConnection({
        connection: CONNECTION,
        supabase: exploding,
      })
    ).resolves.toMatchObject({ failed: 1 });
  });
});
