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
      if (this._t === "opportunity_email_threads" && this._action === "upsert") {
        state.opportunityEmailThreads.push(
          this._payload as Record<string, unknown>
        );
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    then<A = unknown, B = never>(
      f?: ((v: unknown) => A | PromiseLike<A>) | null,
      r?: ((e: unknown) => B | PromiseLike<B>) | null
    ) {
      return Promise.resolve(this._resolve()).then(f, r);
    }
  }
  return { from: (t: string) => new Query(t) };
}

beforeEach(() => vi.clearAllMocks());
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
        },
      ],
      opportunityEmailThreads: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

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
    });

    expect(createNewThreadDraft).toHaveBeenCalledWith(
      "client@customer.com",
      CONTACT_FORM_OUTREACH_SUBJECT,
      expect.stringContaining("deck")
    );
    expect(updateDraft).not.toHaveBeenCalled();
    expect(out).toEqual({ mailboxDraftId: "pd-1", threadId: "new-thread-1" });

    const row = state.aiDraftHistory[0];
    expect(row.status).toBe("auto_drafted");
    expect(row.mailbox_draft_id).toBe("pd-1");
    expect(row.thread_id).toBe("new-thread-1"); // tracks the NEW thread
    expect(row.subject).toBe(CONTACT_FORM_OUTREACH_SUBJECT);
    expect(row.subject_source).toBe("generated");

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
          connection_id: "conn-1",
          opportunity_id: "opp-1",
          status: "auto_drafted",
          thread_id: "new-thread-1",
          mailbox_draft_id: "pd-1",
        },
        {
          id: "dh-2",
          connection_id: "conn-1",
          opportunity_id: "opp-1",
          status: "drafted",
          thread_id: null,
          mailbox_draft_id: null,
        },
      ],
      opportunityEmailThreads: [],
    };
    setSupabaseOverride(makeSupabaseDouble(state) as never);

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
    });

    expect(updateDraft).toHaveBeenCalledWith(
      "pd-1",
      "client@customer.com",
      CONTACT_FORM_OUTREACH_SUBJECT,
      "Updated body",
      "new-thread-1"
    );
    expect(createNewThreadDraft).not.toHaveBeenCalled();
    expect(out).toEqual({ mailboxDraftId: "pd-1", threadId: "new-thread-1" });

    const row = state.aiDraftHistory.find((r) => r.id === "dh-2")!;
    expect(row.status).toBe("auto_drafted");
    expect(row.mailbox_draft_id).toBe("pd-1");
    expect(row.thread_id).toBe("new-thread-1");
  });
});
