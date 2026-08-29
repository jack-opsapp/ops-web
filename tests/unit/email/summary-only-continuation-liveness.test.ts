import { afterEach, describe, expect, it, vi } from "vitest";

import { EmailThreadService } from "@/lib/api/services/email-thread-service";
import {
  isEmailSyncContinuationPending,
  isProviderSyncContinuationPending,
} from "@/lib/email/email-sync-continuation";
import {
  emailProviderSyncPendingForConnection,
  emailSyncContinuationPendingForConnection,
} from "@/lib/email/email-sync-continuation-state";
import { setSupabaseOverride } from "@/lib/supabase/helpers";

/**
 * The exact live shape that froze the primary Canpro mailbox: a v1 OPS wrapper
 * whose providerToken is a PLAIN Gmail historyId (the provider is caught up)
 * carrying only derived lead-summary work.
 */
const SUMMARY_ONLY_CURSOR =
  'ops-email-sync:v1:{"providerToken":"3341840","pendingLeadSummaryOpportunityIds":["opportunity-1","opportunity-2"]}';

/** Same wrapper, but the provider itself still owes pages. */
const PROVIDER_PENDING_CURSOR =
  'ops-email-sync:v1:{"providerToken":"gmail:v1:{\\"pendingMessageIds\\":[\\"m-2\\"]}","pendingLeadSummaryOpportunityIds":["opportunity-1"]}';

type Row = Record<string, unknown>;

function connectionDouble(overrides: {
  historyId?: string | null;
  recoveryPageToken?: string | null;
  syncInProgressAt?: string | null;
}) {
  const data = {
    history_id: overrides.historyId ?? "3341840",
    history_recovery_page_token: overrides.recoveryPageToken ?? null,
    sync_in_progress_at: overrides.syncInProgressAt ?? null,
  };
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data, error: null }),
        }),
      }),
    }),
  } as never;
}

function dirtyThreadRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "dirty-thread-1",
    company_id: "company-1",
    connection_id: "connection-1",
    provider_thread_id: "provider-thread-1",
    primary_category: "CUSTOMER",
    category_confidence: 1,
    category_classifier_version: "deterministic-customer-v1",
    category_manually_set: false,
    category_classified_at: null,
    labels: [],
    subject: "Deck estimate",
    participants: ["customer@example.com", "office@example.com"],
    first_message_at: "2026-08-21T09:00:00.000Z",
    last_message_at: "2026-08-21T10:00:00.000Z",
    message_count: 2,
    unread_count: 1,
    latest_direction: "inbound",
    latest_sender_email: "customer@example.com",
    latest_sender_name: "Customer",
    latest_snippet: "Any update on the estimate?",
    opportunity_id: "opportunity-1",
    client_id: null,
    archived_at: null,
    snoozed_until: null,
    ai_summary: null,
    next_commitment_due_at: null,
    has_unresolved_commitments: false,
    agent_blocking_question: null,
    created_at: "2026-08-21T09:00:01.000Z",
    updated_at: "2026-08-21T10:00:01.000Z",
    ...overrides,
  };
}

/**
 * Minimal double for `retryDirtyClassifications`: one dirty-thread read plus
 * one connection-authority read.
 */
function dirtyQueueDouble(state: {
  threads: Row[];
  connectionHistoryId: string | null;
  connectionRecoveryPageToken?: string | null;
  connectionSyncInProgressAt?: string | null;
}) {
  return {
    from: (table: string) => {
      if (table === "email_threads") {
        const builder: Record<string, unknown> = {
          select: () => builder,
          in: () => builder,
          is: () => builder,
          order: () => builder,
          limit: async () => ({ data: state.threads, error: null }),
        };
        return builder;
      }
      if (table === "email_connections") {
        const builder: Record<string, unknown> = {
          select: () => builder,
          in: async () => ({
            data: [
              {
                id: "connection-1",
                history_id: state.connectionHistoryId,
                history_recovery_page_token:
                  state.connectionRecoveryPageToken ?? null,
                sync_in_progress_at: state.connectionSyncInProgressAt ?? null,
              },
            ],
            error: null,
          }),
        };
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

afterEach(() => {
  setSupabaseOverride(null);
  vi.restoreAllMocks();
});

describe("summary-only continuations and mailbox liveness", () => {
  it("keeps the strict predicate pending while derived summaries remain", () => {
    expect(isEmailSyncContinuationPending(SUMMARY_ONLY_CURSOR)).toBe(true);
    expect(isEmailSyncContinuationPending(PROVIDER_PENDING_CURSOR)).toBe(true);
  });

  it("already reports the provider terminal for a summary-only wrapper", () => {
    expect(isProviderSyncContinuationPending(SUMMARY_ONLY_CURSOR)).toBe(false);
    expect(isProviderSyncContinuationPending(PROVIDER_PENDING_CURSOR)).toBe(
      true
    );
  });

  it("exposes a provider-scoped connection predicate that ignores derived summaries", async () => {
    await expect(
      emailProviderSyncPendingForConnection({
        supabase: connectionDouble({ historyId: SUMMARY_ONLY_CURSOR }),
        connectionId: "connection-1",
        context: "test",
      })
    ).resolves.toBe(false);

    await expect(
      emailProviderSyncPendingForConnection({
        supabase: connectionDouble({ historyId: PROVIDER_PENDING_CURSOR }),
        connectionId: "connection-1",
        context: "test",
      })
    ).resolves.toBe(true);
  });

  it("still refuses on a foreign lease or an unfinished history recovery", async () => {
    await expect(
      emailProviderSyncPendingForConnection({
        supabase: connectionDouble({
          historyId: SUMMARY_ONLY_CURSOR,
          syncInProgressAt: "2026-08-21T21:12:00.000Z",
        }),
        connectionId: "connection-1",
        context: "test",
      })
    ).resolves.toBe(true);

    await expect(
      emailProviderSyncPendingForConnection({
        supabase: connectionDouble({
          historyId: SUMMARY_ONLY_CURSOR,
          syncInProgressAt: "2026-08-21T21:12:00.000Z",
        }),
        connectionId: "connection-1",
        context: "test",
        ownsMailboxLease: true,
      })
    ).resolves.toBe(false);

    await expect(
      emailProviderSyncPendingForConnection({
        supabase: connectionDouble({
          historyId: SUMMARY_ONLY_CURSOR,
          recoveryPageToken: "page-2",
        }),
        connectionId: "connection-1",
        context: "test",
        ownsMailboxLease: true,
      })
    ).resolves.toBe(true);
  });

  it("fails closed when the provider-scoped cursor cannot be read", async () => {
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { message: "boom" },
            }),
          }),
        }),
      }),
    } as never;

    await expect(
      emailProviderSyncPendingForConnection({
        supabase: broken,
        connectionId: "connection-1",
        context: "test",
      })
    ).rejects.toThrow(/mailbox continuation read failed/);
  });

  it("defaults the shared predicate to complete scope and honours an explicit provider scope", async () => {
    await expect(
      emailSyncContinuationPendingForConnection({
        supabase: connectionDouble({ historyId: SUMMARY_ONLY_CURSOR }),
        connectionId: "connection-1",
        context: "test",
      })
    ).resolves.toBe(true);

    await expect(
      emailSyncContinuationPendingForConnection({
        supabase: connectionDouble({ historyId: SUMMARY_ONLY_CURSOR }),
        connectionId: "connection-1",
        context: "test",
        scope: "complete",
      })
    ).resolves.toBe(true);

    await expect(
      emailSyncContinuationPendingForConnection({
        supabase: connectionDouble({ historyId: SUMMARY_ONLY_CURSOR }),
        connectionId: "connection-1",
        context: "test",
        scope: "provider",
      })
    ).resolves.toBe(false);

    await expect(
      emailSyncContinuationPendingForConnection({
        supabase: connectionDouble({ historyId: PROVIDER_PENDING_CURSOR }),
        connectionId: "connection-1",
        context: "test",
        scope: "provider",
      })
    ).resolves.toBe(true);
  });

  it("classifies dirty threads once the provider is caught up, even with summaries pending", async () => {
    setSupabaseOverride(
      dirtyQueueDouble({
        threads: [dirtyThreadRow()],
        connectionHistoryId: SUMMARY_ONLY_CURSOR,
      })
    );
    const classify = vi
      .spyOn(EmailThreadService, "classifyAndUpdate")
      .mockImplementation(async (row) => row);

    await expect(
      EmailThreadService.retryDirtyClassifications({
        companyIds: ["company-1"],
      })
    ).resolves.toEqual({
      scanned: 1,
      classified: 1,
      deferred: 0,
      errors: 0,
    });
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("still defers dirty threads while the provider itself is mid-catch-up", async () => {
    setSupabaseOverride(
      dirtyQueueDouble({
        threads: [dirtyThreadRow()],
        connectionHistoryId: PROVIDER_PENDING_CURSOR,
      })
    );
    const classify = vi.spyOn(EmailThreadService, "classifyAndUpdate");

    await expect(
      EmailThreadService.retryDirtyClassifications({
        companyIds: ["company-1"],
      })
    ).resolves.toEqual({
      scanned: 1,
      classified: 0,
      deferred: 1,
      errors: 0,
    });
    expect(classify).not.toHaveBeenCalled();
  });

  it("still defers while a foreign lease or history recovery is outstanding", async () => {
    setSupabaseOverride(
      dirtyQueueDouble({
        threads: [dirtyThreadRow()],
        connectionHistoryId: SUMMARY_ONLY_CURSOR,
        connectionSyncInProgressAt: "2026-08-21T21:12:00.000Z",
      })
    );
    await expect(
      EmailThreadService.retryDirtyClassifications({
        companyIds: ["company-1"],
      })
    ).resolves.toMatchObject({ deferred: 1, classified: 0 });

    setSupabaseOverride(
      dirtyQueueDouble({
        threads: [dirtyThreadRow()],
        connectionHistoryId: SUMMARY_ONLY_CURSOR,
        connectionRecoveryPageToken: "page-2",
      })
    );
    await expect(
      EmailThreadService.retryDirtyClassifications({
        companyIds: ["company-1"],
      })
    ).resolves.toMatchObject({ deferred: 1, classified: 0 });
  });
});
