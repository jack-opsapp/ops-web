/**
 * Integration test — placeNewThreadDraft (forwarded contact-form → new thread)
 *
 * Exercises the shared helper that backs BOTH the sync auto-draft path and the
 * manual Pipeline "Draft" route. It must:
 *   - create a NEW-thread provider draft (no parent thread) for a first-contact
 *     outreach, capture the minted thread id, and persist it onto
 *     ai_draft_history.thread_id (so reconciliation can track the client reply);
 *   - mark the row auto_drafted + mailbox_draft_id + subject(_source);
 *   - link the new thread to the opportunity (opportunity_email_threads upsert);
 *   - be idempotent per (connection_id, opportunity_id): reuse a prior
 *     auto_drafted mailbox draft via updateDraft instead of minting a 2nd thread.
 *
 * External boundaries mocked: provider (createNewThreadDraft/updateDraft) +
 * requireSupabase / setSupabaseOverride (in-memory DB double).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSupabaseOverride } from "@/lib/supabase/helpers";
import {
  placeNewThreadDraft,
  CONTACT_FORM_OUTREACH_SUBJECT,
} from "@/lib/api/services/mailbox-draft-push";

const { mutationExecuteMock, createMutationServiceMock } = vi.hoisted(() => ({
  mutationExecuteMock: vi.fn(),
  createMutationServiceMock: vi.fn(),
}));

vi.mock("@/lib/api/services/email-provider-mutation-attempt-service", () => ({
  buildEmailProviderMutationFingerprint: vi.fn(() => "f".repeat(64)),
  createEmailProviderMutationAttemptService: createMutationServiceMock,
}));

vi.mock("@/lib/api/services/email-provider-mailbox-operation", () => ({
  runEmailProviderMailboxOperation: async (input: {
    providerLockCheckpoint?: (force?: boolean) => Promise<void>;
    run: (checkpoint: (force?: boolean) => Promise<void>) => Promise<unknown>;
  }) => input.run(input.providerLockCheckpoint ?? (async () => {})),
}));

interface DbState {
  aiDraftHistory: Array<Record<string, unknown>>;
  opportunityEmailThreads: Array<Record<string, unknown>>;
}

function makeSupabaseDouble(state: DbState) {
  class Query {
    private _t: string;
    private _action: "select" | "update" | "upsert" = "select";
    private _payload: Record<string, unknown> | null = null;
    private _filters = new Map<string, unknown>();

    constructor(t: string) {
      this._t = t;
    }
    select() {
      return this;
    }
    eq(c: string, v: unknown) {
      this._filters.set(c, v);
      return this;
    }
    limit(_n: number) {
      return this;
    }
    update(p: Record<string, unknown>) {
      this._action = "update";
      this._payload = p;
      return this;
    }
    upsert(p: Record<string, unknown>, _opts?: { onConflict?: string }) {
      this._action = "upsert";
      this._payload = p;
      return this;
    }
    private _resolve(): { data: unknown; error: null } {
      if (this._t === "ai_draft_history" && this._action === "select") {
        const cid = this._filters.get("connection_id");
        const oid = this._filters.get("opportunity_id");
        const rows = state.aiDraftHistory.filter(
          (r) =>
            (cid === undefined || r.connection_id === cid) &&
            (oid === undefined || r.opportunity_id === oid)
        );
        return { data: rows, error: null };
      }
      if (this._t === "ai_draft_history" && this._action === "update") {
        const id = this._filters.get("id");
        const row = state.aiDraftHistory.find((r) => r.id === id);
        if (row && this._payload) Object.assign(row, this._payload);
        return { data: null, error: null };
      }
      if (
        this._t === "opportunity_email_threads" &&
        this._action === "upsert"
      ) {
        const payload = this._payload as Record<string, unknown>;
        const exists = state.opportunityEmailThreads.some(
          (row) =>
            row.thread_id === payload.thread_id &&
            row.connection_id === payload.connection_id
        );
        if (!exists) state.opportunityEmailThreads.push(payload);
        return { data: null, error: null };
      }
      if (
        this._t === "opportunity_email_threads" &&
        this._action === "select"
      ) {
        const threadId = this._filters.get("thread_id");
        const connectionId = this._filters.get("connection_id");
        return {
          data: state.opportunityEmailThreads.filter(
            (row) =>
              row.thread_id === threadId && row.connection_id === connectionId
          ),
          error: null,
        };
      }
      return { data: null, error: null };
    }
    async maybeSingle() {
      const result = this._resolve();
      const rows = Array.isArray(result.data) ? result.data : [];
      return { data: rows[0] ?? null, error: result.error };
    }
    then<A = unknown, B = never>(
      f?: ((v: unknown) => A | PromiseLike<A>) | null,
      r?: ((e: unknown) => B | PromiseLike<B>) | null
    ) {
      return Promise.resolve(this._resolve()).then(f, r);
    }
  }
  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    if (name !== "reassign_phase_c_mailbox_draft") {
      return { data: null, error: { message: `unexpected RPC ${name}` } };
    }
    const newId = params.p_new_draft_history_id;
    const newRow = state.aiDraftHistory.find((row) => row.id === newId);
    if (!newRow) {
      return { data: null, error: { message: "new history missing" } };
    }
    for (const row of state.aiDraftHistory) {
      if (
        row.id !== newId &&
        row.connection_id === params.p_connection_id &&
        row.status === "auto_drafted" &&
        (row.thread_id === params.p_thread_id ||
          row.mailbox_draft_id === params.p_mailbox_draft_id)
      ) {
        row.status = "superseded";
      }
    }
    Object.assign(newRow, {
      status: "auto_drafted",
      mailbox_draft_id: params.p_mailbox_draft_id,
      thread_id: params.p_thread_id,
      subject: params.p_subject,
    });
    return { data: { draft_history_id: newId }, error: null };
  });
  return { from: vi.fn((t: string) => new Query(t)), rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  mutationExecuteMock.mockImplementation(async (input) => {
    const output = await input.executeProvider();
    await input.reconcile({
      attemptId: "attempt-1",
      resourceId: output.resourceId,
      secondaryResourceId: output.secondaryResourceId ?? null,
      result: output.result ?? {},
    });
    return {
      status: "completed",
      providerResourceId: output.resourceId,
      providerSecondaryResourceId: output.secondaryResourceId ?? null,
    };
  });
  createMutationServiceMock.mockReturnValue({ execute: mutationExecuteMock });
});
afterEach(() => setSupabaseOverride(null));

describe("placeNewThreadDraft", () => {
  it("creates a new-thread draft, persists new thread_id + mailbox_draft_id + status, and links the thread", async () => {
    const state: DbState = {
      aiDraftHistory: [
        {
          id: "dh-1",
          connection_id: "conn-1",
          opportunity_id: "opp-1",
          status: "drafted",
          thread_id: null,
          mailbox_draft_id: null,
          subject_source: "learned",
        },
      ],
      opportunityEmailThreads: [],
    };
    const database = makeSupabaseDouble(state);
    setSupabaseOverride(database as never);

    const createNewThreadDraft = vi
      .fn()
      .mockResolvedValue({ draftId: "pd-1", threadId: "new-thread-1" });
    const updateDraft = vi.fn();

    const out = await placeNewThreadDraft({
      provider: { createNewThreadDraft, updateDraft } as never,
      connectionId: "conn-1",
      opportunityId: "opp-1",
      draftHistoryId: "dh-1",
      to: "client@customer.com",
      subject: CONTACT_FORM_OUTREACH_SUBJECT,
      body: "Thanks — happy to help with your deck.",
      durableProviderMutation: {
        actorUserId: "user-1",
        operationKey: "manual-new-thread-draft:dh-1",
      },
    });

    expect(createNewThreadDraft).toHaveBeenCalledWith(
      "client@customer.com",
      CONTACT_FORM_OUTREACH_SUBJECT,
      expect.stringContaining("deck"),
      "text"
    );
    expect(updateDraft).not.toHaveBeenCalled();
    expect(mutationExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-1",
        connectionId: "conn-1",
        operationKind: "draft_create",
        operationKey: "manual-new-thread-draft:dh-1",
      })
    );
    expect(out).toEqual({ mailboxDraftId: "pd-1", threadId: "new-thread-1" });

    const row = state.aiDraftHistory[0];
    expect(row.status).toBe("auto_drafted");
    expect(row.mailbox_draft_id).toBe("pd-1");
    expect(row.thread_id).toBe("new-thread-1"); // tracks the NEW thread
    expect(row.subject).toBe(CONTACT_FORM_OUTREACH_SUBJECT);
    expect(row.subject_source).toBe("learned");

    // The new thread must be linked to the opportunity so the user's eventual
    // send creates an outbound activity reconciliation can detect.
    expect(state.opportunityEmailThreads).toContainEqual({
      opportunity_id: "opp-1",
      thread_id: "new-thread-1",
      connection_id: "conn-1",
    });
  });

  it("reuses a prior auto_drafted draft for the same opportunity (updateDraft, no second thread)", async () => {
    const state: DbState = {
      aiDraftHistory: [
        {
          id: "dh-prior",
          company_id: "company-1",
          connection_id: "conn-1",
          opportunity_id: "opp-1",
          origin: "phase_c",
          status: "auto_drafted",
          thread_id: "new-thread-1",
          mailbox_draft_id: "pd-1",
        },
        {
          id: "dh-2",
          company_id: "company-1",
          connection_id: "conn-1",
          opportunity_id: "opp-1",
          origin: "phase_c",
          status: "drafted",
          thread_id: null,
          mailbox_draft_id: null,
        },
      ],
      opportunityEmailThreads: [],
    };
    const database = makeSupabaseDouble(state);
    setSupabaseOverride(database as never);

    const createNewThreadDraft = vi.fn();
    const updateDraft = vi.fn().mockResolvedValue(undefined);

    const out = await placeNewThreadDraft({
      provider: { createNewThreadDraft, updateDraft } as never,
      connectionId: "conn-1",
      opportunityId: "opp-1",
      draftHistoryId: "dh-2",
      to: "client@customer.com",
      subject: CONTACT_FORM_OUTREACH_SUBJECT,
      body: "Updated body",
      phaseCCompanyId: "company-1",
    });

    expect(updateDraft).toHaveBeenCalledWith(
      "pd-1",
      "client@customer.com",
      CONTACT_FORM_OUTREACH_SUBJECT,
      "Updated body",
      "new-thread-1",
      "text"
    );
    expect(createNewThreadDraft).not.toHaveBeenCalled();
    expect(out).toEqual({ mailboxDraftId: "pd-1", threadId: "new-thread-1" });

    const row = state.aiDraftHistory.find((r) => r.id === "dh-2")!;
    expect(row.status).toBe("auto_drafted");
    expect(row.mailbox_draft_id).toBe("pd-1");
    expect(row.thread_id).toBe("new-thread-1");
    expect(state.aiDraftHistory.find((r) => r.id === "dh-prior")?.status).toBe(
      "superseded"
    );
    expect(database.rpc).toHaveBeenCalledWith(
      "reassign_phase_c_mailbox_draft",
      {
        p_company_id: "company-1",
        p_connection_id: "conn-1",
        p_thread_id: "new-thread-1",
        p_new_draft_history_id: "dh-2",
        p_mailbox_draft_id: "pd-1",
        p_expected_old_draft_history_id: "dh-prior",
        p_subject: CONTACT_FORM_OUTREACH_SUBJECT,
      }
    );
  });

  it("updates one exact prior OPS draft without inventorying or creating beside it", async () => {
    const state: DbState = {
      aiDraftHistory: [
        {
          id: "dh-old-assignee",
          company_id: "company-1",
          connection_id: "conn-1",
          opportunity_id: "opp-1",
          origin: "phase_c",
          status: "auto_drafted",
          thread_id: "old-thread",
          mailbox_draft_id: "old-provider-draft",
        },
        {
          id: "dh-current-assignee",
          company_id: "company-1",
          connection_id: "conn-1",
          opportunity_id: "opp-1",
          origin: "phase_c",
          status: "drafted",
          thread_id: null,
          mailbox_draft_id: null,
        },
      ],
      opportunityEmailThreads: [],
    };
    const database = makeSupabaseDouble(state);
    setSupabaseOverride(database as never);

    const createNewThreadDraft = vi.fn().mockResolvedValue({
      draftId: "new-provider-draft",
      threadId: "new-provider-thread",
    });
    const updateDraft = vi.fn();
    const listDrafts = vi.fn().mockResolvedValue([
      {
        id: "human-identical-draft",
        threadId: "human-thread",
        to: ["client@customer.com"],
        cc: [],
        subject: CONTACT_FORM_OUTREACH_SUBJECT,
        bodyText: "Updated body",
        updatedAt: new Date("2026-07-15T12:00:05.000Z"),
      },
    ]);
    const persistPlacement = vi.fn().mockResolvedValue(true);

    const out = await placeNewThreadDraft({
      provider: { createNewThreadDraft, updateDraft, listDrafts } as never,
      connectionId: "conn-1",
      opportunityId: "opp-1",
      draftHistoryId: "dh-current-assignee",
      to: "client@customer.com",
      subject: CONTACT_FORM_OUTREACH_SUBJECT,
      body: "Updated body",
      phaseCCompanyId: "company-1",
      forceCreate: false,
      exactReusableDraft: {
        mailboxDraftId: "old-provider-draft",
        threadId: "old-thread",
      },
      persistPlacement,
    });

    expect(updateDraft).toHaveBeenCalledWith(
      "old-provider-draft",
      "client@customer.com",
      CONTACT_FORM_OUTREACH_SUBJECT,
      "Updated body",
      "old-thread",
      "text"
    );
    expect(listDrafts).not.toHaveBeenCalled();
    expect(createNewThreadDraft).not.toHaveBeenCalled();
    expect(database.from).not.toHaveBeenCalled();
    expect(persistPlacement).toHaveBeenCalledWith({
      mailboxDraftId: "old-provider-draft",
      threadId: "old-thread",
    });
    expect(out).toEqual({
      mailboxDraftId: "old-provider-draft",
      threadId: "old-thread",
    });
  });

  it("does not attribute a provider-created draft when atomic queue completion loses authorization", async () => {
    const state: DbState = {
      aiDraftHistory: [
        {
          id: "dh-stale",
          company_id: "company-1",
          connection_id: "conn-1",
          opportunity_id: "opp-1",
          origin: "phase_c",
          status: "drafted",
          thread_id: null,
          mailbox_draft_id: null,
        },
      ],
      opportunityEmailThreads: [],
    };
    const database = makeSupabaseDouble(state);
    setSupabaseOverride(database as never);

    const createNewThreadDraft = vi
      .fn()
      .mockResolvedValue({ draftId: "pd-stale", threadId: "thread-stale" });
    const persistPlacement = vi.fn().mockResolvedValue(false);

    await expect(
      placeNewThreadDraft({
        provider: {
          createNewThreadDraft,
          updateDraft: vi.fn(),
        } as never,
        connectionId: "conn-1",
        opportunityId: "opp-1",
        draftHistoryId: "dh-stale",
        to: "client@customer.com",
        subject: CONTACT_FORM_OUTREACH_SUBJECT,
        body: "Thanks — happy to help with your deck.",
        phaseCCompanyId: "company-1",
        forceCreate: true,
        persistPlacement,
      })
    ).rejects.toThrow("Atomic placement persistence was rejected");

    expect(createNewThreadDraft).toHaveBeenCalledTimes(1);
    expect(persistPlacement).toHaveBeenCalledWith({
      mailboxDraftId: "pd-stale",
      threadId: "thread-stale",
    });
    expect(database.rpc).not.toHaveBeenCalled();
    expect(state.aiDraftHistory[0]?.status).toBe("drafted");
    expect(state.opportunityEmailThreads).toEqual([]);
  });

  it("delegates all Phase C history, link, and queue writes to one atomic persistence callback", async () => {
    const state: DbState = {
      aiDraftHistory: [
        {
          id: "dh-atomic",
          company_id: "company-1",
          connection_id: "conn-1",
          opportunity_id: "opp-1",
          origin: "phase_c",
          status: "drafted",
          thread_id: null,
          mailbox_draft_id: null,
        },
      ],
      opportunityEmailThreads: [],
    };
    const database = makeSupabaseDouble(state);
    setSupabaseOverride(database as never);
    const persistPlacement = vi.fn().mockResolvedValue(true);

    const out = await placeNewThreadDraft({
      provider: {
        createNewThreadDraft: vi.fn().mockResolvedValue({
          draftId: "pd-atomic",
          threadId: "thread-atomic",
        }),
        updateDraft: vi.fn(),
      } as never,
      connectionId: "conn-1",
      opportunityId: "opp-1",
      draftHistoryId: "dh-atomic",
      to: "client@customer.com",
      subject: CONTACT_FORM_OUTREACH_SUBJECT,
      body: "Thanks — happy to help with your deck.",
      phaseCCompanyId: "company-1",
      forceCreate: true,
      persistPlacement,
    });

    expect(out).toEqual({
      mailboxDraftId: "pd-atomic",
      threadId: "thread-atomic",
    });
    expect(persistPlacement).toHaveBeenCalledWith({
      mailboxDraftId: "pd-atomic",
      threadId: "thread-atomic",
    });
    expect(database.rpc).not.toHaveBeenCalled();
    expect(state.aiDraftHistory[0]?.status).toBe("drafted");
    expect(state.opportunityEmailThreads).toEqual([]);
  });
});
