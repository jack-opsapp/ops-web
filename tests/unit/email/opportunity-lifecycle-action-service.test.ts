import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LEAD_LIFECYCLE_SETTINGS,
  type OpportunityLifecycleDecision,
} from "@/lib/email/opportunity-lifecycle-evaluator";
import {
  executeOpportunityLifecycleAction,
  resetStaleLifecycleAfterMeaningfulInbound,
  type OpportunityLifecycleActionInput,
} from "@/lib/api/services/opportunity-lifecycle-action-service";
import { EmailService } from "@/lib/api/services/email-service";

vi.mock("@/lib/api/services/email-service", () => ({
  EmailService: {
    getProvider: vi.fn(),
  },
}));

interface TableState {
  opportunity_follow_up_drafts: Array<Record<string, unknown>>;
  opportunity_lifecycle_state: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
}

interface SupabaseDoubleOptions {
  failLifecycleStateUpsert?: boolean;
}

const P4_MIGRATION_SQL = readFileSync(
  "supabase/migrations/20260527140000_lead_lifecycle_p4_foundation.sql",
  "utf8"
);
const STALE_STATUS_CHECK_SQL = P4_MIGRATION_SQL.match(
  /stale_status text check \([\s\S]*?\),\n  stale_status_at/
)?.[0];

if (!STALE_STATUS_CHECK_SQL) {
  throw new Error("Could not find opportunity_lifecycle_state.stale_status constraint");
}

const MIGRATION_ALLOWED_STALE_STATUSES = new Set(
  [...STALE_STATUS_CHECK_SQL.matchAll(/'([^']+)'/g)].map((match) => match[1])
);

function assertMigrationAllowedStaleStatus(payload: Record<string, unknown>) {
  const staleStatus = payload.stale_status;
  if (staleStatus == null) return;
  if (!MIGRATION_ALLOWED_STALE_STATUSES.has(String(staleStatus))) {
    throw new Error(
      `stale_status '${String(staleStatus)}' is not allowed by the P4 migration`
    );
  }
}

function makeDecision(
  action: OpportunityLifecycleDecision["action"],
  evidence: Record<string, unknown> = {}
): OpportunityLifecycleDecision {
  return {
    action,
    dryRun: true,
    ignored: false,
    reason: `${action} reason`,
    opportunityId: "opp-1",
    evidence,
  };
}

function matches(row: Record<string, unknown>, filters: Map<string, unknown>): boolean {
  for (const [column, value] of filters.entries()) {
    if (row[column] !== value) return false;
  }
  return true;
}

function makeSupabaseDouble(state: TableState, options: SupabaseDoubleOptions = {}) {
  class Query {
    private filters = new Map<string, unknown>();
    private updatePayload: Record<string, unknown> | null = null;
    private limitCount: number | null = null;

    constructor(private readonly table: keyof TableState) {}

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    order() {
      return this;
    }

    limit(count: number) {
      this.limitCount = count;
      return this;
    }

    insert(payload: Record<string, unknown>) {
      const row = { id: `${this.table}-${state[this.table].length + 1}`, ...payload };
      state[this.table].push(row);
      return {
        select: () => ({
          single: async () => ({ data: row, error: null }),
        }),
        single: async () => ({ data: row, error: null }),
        then: (onfulfilled: (value: unknown) => unknown) =>
          Promise.resolve({ data: row, error: null }).then(onfulfilled),
      };
    }

    update(payload: Record<string, unknown>) {
      this.updatePayload = payload;
      return this;
    }

    upsert(payload: Record<string, unknown>) {
      if (this.table === "opportunity_lifecycle_state") {
        assertMigrationAllowedStaleStatus(payload);
        if (options.failLifecycleStateUpsert) {
          return {
            then: (onfulfilled: (value: unknown) => unknown) =>
              Promise.resolve({
                data: null,
                error: { message: "constraint failed" },
              }).then(onfulfilled),
          };
        }
      }

      const rows = state[this.table];
      const existing = rows.find((row) => row.opportunity_id === payload.opportunity_id);
      if (existing) {
        Object.assign(existing, payload);
      } else {
        rows.push({ ...payload });
      }
      return {
        then: (onfulfilled: (value: unknown) => unknown) =>
          Promise.resolve({ data: payload, error: null }).then(onfulfilled),
      };
    }

    async maybeSingle() {
      const row = state[this.table].find((candidate) =>
        matches(candidate, this.filters)
      );
      return { data: row ?? null, error: null };
    }

    async single() {
      const row = state[this.table].find((candidate) =>
        matches(candidate, this.filters)
      );
      return { data: row ?? null, error: null };
    }

    private applyUpdate() {
      if (!this.updatePayload) return;
      for (const row of state[this.table]) {
        if (matches(row, this.filters)) Object.assign(row, this.updatePayload);
      }
    }

    private result() {
      this.applyUpdate();
      const rows = state[this.table].filter((row) => matches(row, this.filters));
      return {
        data: this.limitCount === 1 ? rows.slice(0, 1) : rows,
        error: null,
      };
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ) {
      return Promise.resolve(this.result()).then(onfulfilled, onrejected);
    }
  }

  return {
    from(table: string) {
      return new Query(table as keyof TableState);
    },
  };
}

function makeInput(
  overrides: Partial<OpportunityLifecycleActionInput> = {},
  state: TableState = {
    opportunity_follow_up_drafts: [],
    opportunity_lifecycle_state: [],
    notifications: [],
  },
  options: SupabaseDoubleOptions = {}
): OpportunityLifecycleActionInput {
  return {
    supabase: makeSupabaseDouble(state, options),
    mode: "apply",
    companyId: "company-1",
    opportunityId: "opp-1",
    opportunityTitle: "Deck quote",
    decision: makeDecision("create_follow_up_draft", {
      latestEventId: "event-1",
    }),
    lifecycleState: {
      unansweredFollowUpCount: 0,
      lastMeaningfulAt: "2026-05-20T18:00:00.000Z",
      lastMeaningfulDirection: "outbound",
    },
    settings: {
      ...DEFAULT_LEAD_LIFECYCLE_SETTINGS,
      followUpTemplateSubject: "Checking in",
      followUpTemplateBody: "Hey there {{first_name}}, just following up.",
    },
    latestMeaningfulEvent: {
      id: "event-1",
      direction: "outbound",
      isMeaningful: true,
      occurredAt: "2026-05-20T18:00:00.000Z",
      connectionId: "connection-1",
      providerThreadId: "thread-1",
    },
    operatorUserId: "user-1",
    contactName: "Kara Beach",
    now: new Date("2026-05-27T18:00:00.000Z"),
    ...overrides,
  };
}

describe("opportunity lifecycle action service", () => {
  beforeEach(() => {
    vi.mocked(EmailService.getProvider).mockReset();
  });

  it("creates a local template follow-up draft from a create_follow_up_draft decision", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
    };

    const result = await executeOpportunityLifecycleAction(makeInput({}, state));

    expect(result.operations.draft).toBe("created");
    expect(state.opportunity_follow_up_drafts).toEqual([
      expect.objectContaining({
        company_id: "company-1",
        opportunity_id: "opp-1",
        connection_id: "connection-1",
        provider_thread_id: "thread-1",
        source_event_id: "event-1",
        origin: "template_follow_up",
        status: "drafted",
        sequence_number: 1,
        subject: "Checking in",
        original_body: "Hey there Kara, just following up.",
        current_body: "Hey there Kara, just following up.",
        provider_draft_id: null,
      }),
    ]);
    expect(state.opportunity_lifecycle_state[0]).toMatchObject({
      opportunity_id: "opp-1",
      stale_status: "follow_up_draft_due",
    });
  });

  it("does not insert a template draft when lifecycle state cannot be persisted", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
    };

    const result = await executeOpportunityLifecycleAction(
      makeInput({}, state, { failLifecycleStateUpsert: true })
    );

    expect(result.applied).toBe(false);
    expect(result.operations.lifecycleState).toBe("skipped_update_failed");
    expect(result.operations.draft).toBe("skipped_lifecycle_state_failed");
    expect(state.opportunity_follow_up_drafts).toHaveLength(0);
    expect(state.opportunity_lifecycle_state).toHaveLength(0);
  });

  it("does not duplicate an existing open template draft on repeated execution", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
    };

    await executeOpportunityLifecycleAction(makeInput({}, state));
    const second = await executeOpportunityLifecycleAction(makeInput({}, state));

    expect(second.operations.draft).toBe("skipped_existing_open_template");
    expect(state.opportunity_follow_up_drafts).toHaveLength(1);
  });

  it("does not overwrite manual, Phase C, or provider-backed drafts", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [
        {
          id: "manual-1",
          company_id: "company-1",
          opportunity_id: "opp-1",
          origin: "operator",
          status: "drafted",
          current_body: "Manual text",
        },
        {
          id: "phase-c-1",
          company_id: "company-1",
          opportunity_id: "opp-1",
          origin: "phase_c",
          status: "drafted",
          provider_draft_id: "provider-draft-1",
          current_body: "Phase C text",
        },
      ],
      opportunity_lifecycle_state: [],
      notifications: [],
    };

    await executeOpportunityLifecycleAction(makeInput({}, state));

    expect(state.opportunity_follow_up_drafts).toHaveLength(3);
    expect(state.opportunity_follow_up_drafts[0].current_body).toBe("Manual text");
    expect(state.opportunity_follow_up_drafts[1].provider_draft_id).toBe(
      "provider-draft-1"
    );
    expect(state.opportunity_follow_up_drafts[2]).toMatchObject({
      origin: "template_follow_up",
      provider_draft_id: null,
    });
  });

  it("creates and dedupes persistent operator follow-up miss notifications", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
    };
    const input = makeInput(
      {
        decision: makeDecision("operator_follow_up_miss", {
          latestEventId: "event-in-1",
        }),
        latestMeaningfulEvent: {
          id: "event-in-1",
          direction: "inbound",
          isMeaningful: true,
          occurredAt: "2026-05-27T17:00:00.000Z",
          connectionId: "connection-1",
          providerThreadId: "thread-1",
        },
      },
      state
    );

    const first = await executeOpportunityLifecycleAction(input);
    const second = await executeOpportunityLifecycleAction(input);

    expect(first.operations.notification).toBe("created");
    expect(second.operations.notification).toBe("skipped_existing_unread");
    expect(state.notifications).toEqual([
      expect.objectContaining({
        user_id: "user-1",
        company_id: "company-1",
        type: "leads_waiting",
        persistent: true,
        is_read: false,
        action_url: "/inbox/thread-1",
        action_label: "Open thread",
      }),
    ]);
    expect(state.opportunity_lifecycle_state[0]).toMatchObject({
      opportunity_id: "opp-1",
      operator_follow_up_miss_at: "2026-05-27T18:00:00.000Z",
      stale_status: "operator_follow_up_miss",
    });
  });

  it("supersedes stale template drafts and clears stale state after a meaningful inbound", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [
        {
          id: "template-1",
          company_id: "company-1",
          opportunity_id: "opp-1",
          origin: "template_follow_up",
          status: "drafted",
          current_body: "Checking in.",
          superseded_at: null,
        },
        {
          id: "manual-1",
          company_id: "company-1",
          opportunity_id: "opp-1",
          origin: "operator",
          status: "drafted",
          current_body: "Manual.",
          superseded_at: null,
        },
      ],
      opportunity_lifecycle_state: [
        {
          opportunity_id: "opp-1",
          company_id: "company-1",
          stale_status: "follow_up_draft_due",
          stale_status_at: "2026-05-24T18:00:00.000Z",
          operator_follow_up_miss_at: "2026-05-24T18:00:00.000Z",
        },
      ],
      notifications: [],
    };

    const result = await resetStaleLifecycleAfterMeaningfulInbound({
      supabase: makeSupabaseDouble(state),
      companyId: "company-1",
      opportunityId: "opp-1",
      eventId: "event-in-1",
      occurredAt: "2026-05-27T18:00:00.000Z",
      now: new Date("2026-05-27T18:01:00.000Z"),
      mode: "apply",
    });

    expect(result.operations.supersededDrafts).toBe(1);
    expect(state.opportunity_follow_up_drafts[0]).toMatchObject({
      status: "superseded",
      superseded_at: "2026-05-27T18:01:00.000Z",
    });
    expect(state.opportunity_follow_up_drafts[1]).toMatchObject({
      origin: "operator",
      status: "drafted",
      superseded_at: null,
    });
    expect(state.opportunity_lifecycle_state[0]).toMatchObject({
      stale_status: null,
      stale_status_at: null,
      operator_follow_up_miss_at: null,
    });
  });

  it("skips destructive lifecycle decisions in P4-8", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
    };

    for (const action of [
      "archive_after_two_unanswered_followups",
      "archive_no_meaningful_correspondence",
      "move_to_lost_operator_no_response",
      "reactivate_on_related_inbound",
    ] satisfies OpportunityLifecycleDecision["action"][]) {
      const result = await executeOpportunityLifecycleAction(
        makeInput({ decision: makeDecision(action) }, state)
      );
      expect(result.skippedReason).toBe("destructive_action_not_allowed");
    }

    expect(state.opportunity_follow_up_drafts).toHaveLength(0);
    expect(state.opportunity_lifecycle_state).toHaveLength(0);
    expect(state.notifications).toHaveLength(0);
  });

  it("does not call provider draft or send APIs", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
    };

    await executeOpportunityLifecycleAction(makeInput({}, state));

    expect(EmailService.getProvider).not.toHaveBeenCalled();
  });

  it("dry-run mode returns planned operations without writing rows", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
    };

    const result = await executeOpportunityLifecycleAction(
      makeInput({ mode: "dry-run" }, state)
    );

    expect(result.operations.draft).toBe("would_create");
    expect(result.operations.lifecycleState).toBe("would_update");
    expect(state.opportunity_follow_up_drafts).toHaveLength(0);
    expect(state.opportunity_lifecycle_state).toHaveLength(0);
    expect(state.notifications).toHaveLength(0);
  });
});
