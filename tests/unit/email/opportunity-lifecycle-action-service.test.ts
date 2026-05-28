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
  opportunities?: Array<Record<string, unknown>>;
  opportunity_lifecycle_action_audit?: Array<Record<string, unknown>>;
}

interface SupabaseDoubleOptions {
  failLifecycleStateUpsert?: boolean;
  failGuardedActionRpc?: boolean;
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
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  class Query {
    private filters = new Map<string, unknown>();
    private nullFilters = new Set<string>();
    private updatePayload: Record<string, unknown> | null = null;
    private limitCount: number | null = null;

    constructor(private readonly table: keyof TableState) {}

    private rows(): Array<Record<string, unknown>> {
      const existing = state[this.table];
      if (existing) return existing;
      const rows: Array<Record<string, unknown>> = [];
      state[this.table] = rows;
      return rows;
    }

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    is(column: string, value: unknown) {
      if (value === null) {
        this.nullFilters.add(column);
      } else {
        this.filters.set(column, value);
      }
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
      const rows = this.rows();
      const row = { id: `${this.table}-${rows.length + 1}`, ...payload };
      rows.push(row);
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

      const rows = this.rows();
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
      const rows = this.rows().filter((candidate) => this.matches(candidate));
      this.applyUpdate();
      const row = rows[0];
      return { data: row ?? null, error: null };
    }

    async single() {
      const rows = this.rows().filter((candidate) => this.matches(candidate));
      this.applyUpdate();
      const row = rows[0];
      return { data: row ?? null, error: null };
    }

    private matches(row: Record<string, unknown>) {
      return (
        matches(row, this.filters) &&
        [...this.nullFilters].every((column) => row[column] == null)
      );
    }

    private applyUpdate() {
      if (!this.updatePayload) return;
      for (const row of this.rows()) {
        if (this.matches(row)) Object.assign(row, this.updatePayload);
      }
    }

    private result() {
      const rows = this.rows().filter((row) => this.matches(row));
      this.applyUpdate();
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
    rpcCalls,
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      if (options.failGuardedActionRpc) {
        return {
          data: null,
          error: { message: "audit insert failed" },
        };
      }
      return {
        data: {
          applied: true,
          audit_status: "recorded",
          opportunity_status: "updated",
        },
        error: null,
      };
    },
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

  it("archives a stale opportunity by setting archived_at only", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
      opportunities: [
        {
          id: "opp-1",
          company_id: "company-1",
          stage: "follow_up",
          archived_at: null,
          deleted_at: null,
          project_id: null,
          project_ref: null,
          lost_reason: null,
          lost_notes: null,
          actual_close_date: null,
        },
      ],
      opportunity_lifecycle_action_audit: [],
    };

    const input = makeInput(
      {
        decision: makeDecision("archive_after_two_unanswered_followups"),
        now: new Date("2026-05-27T18:00:00.000Z"),
        approvedActionKey: "opp-1:archive_after_two_unanswered_followups:approved",
        opportunity: {
          id: "opp-1",
          companyId: "company-1",
          stage: "follow_up",
          archivedAt: null,
          deletedAt: null,
          projectId: null,
          projectRef: null,
          lostReason: null,
          lostNotes: null,
          actualCloseDate: null,
        },
      } as Partial<OpportunityLifecycleActionInput> & Record<string, unknown>,
      state
    );

    const result = await executeOpportunityLifecycleAction(input);

    expect(result.applied).toBe(true);
    expect(result.operations.opportunity).toBe("archived");
    expect(state.opportunities?.[0]).toMatchObject({
      stage: "follow_up",
      archived_at: null,
      lost_reason: null,
      lost_notes: null,
      actual_close_date: null,
    });
    const rpcCall = (input.supabase as ReturnType<typeof makeSupabaseDouble>).rpcCalls[0];
    expect(rpcCall.fn).toBe("execute_opportunity_lifecycle_guarded_action");
    expect(rpcCall.args.p_before_values).toEqual({ archived_at: null });
    expect(rpcCall.args.p_after_values).toEqual({
      archived_at: "2026-05-27T18:00:00.000Z",
    });
    expect(JSON.stringify(rpcCall.args)).not.toContain("updated_at");
    expect(state.opportunity_lifecycle_action_audit).toHaveLength(0);
  });

  it("uses the atomic RPC boundary and exact archived_at payload for archive apply", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
      opportunities: [
        {
          id: "opp-1",
          company_id: "company-1",
          stage: "follow_up",
          archived_at: null,
          deleted_at: null,
          project_id: null,
          project_ref: null,
          lost_reason: null,
          lost_notes: null,
          actual_close_date: null,
        },
      ],
      opportunity_lifecycle_action_audit: [],
    };
    const input = makeInput(
      {
        decision: makeDecision("archive_after_two_unanswered_followups"),
        now: new Date("2026-05-27T18:00:00.000Z"),
        approvedActionKey: "opp-1:archive_after_two_unanswered_followups:approved",
        opportunity: {
          id: "opp-1",
          companyId: "company-1",
          stage: "follow_up",
          archivedAt: null,
          deletedAt: null,
          projectId: null,
          projectRef: null,
          lostReason: null,
          lostNotes: null,
          actualCloseDate: null,
        },
      } as Partial<OpportunityLifecycleActionInput> & Record<string, unknown>,
      state
    );

    const result = await executeOpportunityLifecycleAction(input);

    const rpcCall = (input.supabase as ReturnType<typeof makeSupabaseDouble>).rpcCalls[0];
    expect(result.applied).toBe(true);
    expect(result.beforeValues).toEqual({ archived_at: null });
    expect(result.afterValues).toEqual({
      archived_at: "2026-05-27T18:00:00.000Z",
    });
    expect(rpcCall.fn).toBe("execute_opportunity_lifecycle_guarded_action");
    expect(rpcCall.args.p_action).toBe("archive_after_two_unanswered_followups");
    expect(rpcCall.args.p_before_values).toEqual(result.beforeValues);
    expect(rpcCall.args.p_after_values).toEqual(result.afterValues);
    expect(JSON.stringify(rpcCall.args)).not.toContain("updated_at");
    expect(state.opportunities?.[0]).toMatchObject({
      stage: "follow_up",
      archived_at: null,
      lost_reason: null,
      lost_notes: null,
      actual_close_date: null,
    });
    expect(state.opportunity_follow_up_drafts).toHaveLength(0);
    expect(state.notifications).toHaveLength(0);
    expect(state.opportunity_lifecycle_action_audit).toHaveLength(0);
  });

  it("does not archive the same opportunity twice", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
      opportunities: [
        {
          id: "opp-1",
          company_id: "company-1",
          stage: "follow_up",
          archived_at: null,
          deleted_at: null,
          project_id: null,
          project_ref: null,
        },
      ],
      opportunity_lifecycle_action_audit: [],
    };
    const input = makeInput(
      {
        decision: makeDecision("archive_no_meaningful_correspondence"),
        now: new Date("2026-05-27T18:00:00.000Z"),
        approvedActionKey: "opp-1:archive_no_meaningful_correspondence:approved",
        opportunity: {
          id: "opp-1",
          companyId: "company-1",
          stage: "follow_up",
          archivedAt: null,
          deletedAt: null,
          projectId: null,
          projectRef: null,
        },
      } as Partial<OpportunityLifecycleActionInput> & Record<string, unknown>,
      state
    );

    const first = await executeOpportunityLifecycleAction(input);
    const second = await executeOpportunityLifecycleAction({
      ...input,
      opportunity: {
        id: "opp-1",
        companyId: "company-1",
        stage: "follow_up",
        archivedAt: "2026-05-27T18:00:00.000Z",
        deletedAt: null,
        projectId: null,
        projectRef: null,
      },
    } as OpportunityLifecycleActionInput & Record<string, unknown>);

    expect(first.operations.opportunity).toBe("archived");
    expect(second.operations.opportunity).toBe("skipped_already_archived");
    expect(state.opportunities?.[0].archived_at).toBeNull();
  });

  it("marks beyond-qualified operator no-response opportunities lost", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
      opportunities: [
        {
          id: "opp-1",
          company_id: "company-1",
          stage: "quoted",
          archived_at: null,
          deleted_at: null,
          project_id: null,
          project_ref: null,
          lost_reason: null,
          lost_notes: null,
          actual_close_date: null,
        },
      ],
      opportunity_lifecycle_action_audit: [],
    };

    const result = await executeOpportunityLifecycleAction(
      makeInput(
        {
          decision: makeDecision("move_to_lost_operator_no_response", {
            latestEventId: "event-in-1",
          }),
          now: new Date("2026-05-27T18:00:00.000Z"),
          approvedActionKey: "opp-1:move_to_lost_operator_no_response:approved",
          opportunity: {
            id: "opp-1",
            companyId: "company-1",
            stage: "quoted",
            archivedAt: null,
            deletedAt: null,
            projectId: null,
            projectRef: null,
            lostReason: null,
            lostNotes: null,
            actualCloseDate: null,
          },
        } as Partial<OpportunityLifecycleActionInput> & Record<string, unknown>,
        state
      )
    );

    expect(result.operations.opportunity).toBe("moved_to_lost");
    expect(result.beforeValues).toEqual({
      stage: "quoted",
      lost_reason: null,
      lost_notes: null,
      actual_close_date: null,
    });
    expect(result.afterValues).toEqual({
      stage: "lost",
      lost_reason: "operator_no_response",
      lost_notes:
        "Guarded lifecycle approval: customer inbound went unanswered past the no-response window.",
      actual_close_date: "2026-05-27",
    });
    expect(state.opportunities?.[0]).toMatchObject({
      stage: "quoted",
      lost_reason: null,
      lost_notes: null,
      actual_close_date: null,
      archived_at: null,
    });
  });

  it("uses exact lost-field before/after values and no updated_at for lost apply", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
      opportunities: [],
      opportunity_lifecycle_action_audit: [],
    };
    const input = makeInput(
      {
        decision: makeDecision("move_to_lost_operator_no_response", {
          latestEventId: "event-in-1",
        }),
        now: new Date("2026-05-27T18:00:00.000Z"),
        approvedActionKey: "opp-1:move_to_lost_operator_no_response:approved",
        opportunity: {
          id: "opp-1",
          companyId: "company-1",
          stage: "quoted",
          archivedAt: null,
          deletedAt: null,
          projectId: null,
          projectRef: null,
          lostReason: null,
          lostNotes: null,
          actualCloseDate: null,
        },
      } as Partial<OpportunityLifecycleActionInput> & Record<string, unknown>,
      state
    );

    const result = await executeOpportunityLifecycleAction(input);

    const rpcCall = (input.supabase as ReturnType<typeof makeSupabaseDouble>).rpcCalls[0];
    expect(result.beforeValues).toEqual({
      stage: "quoted",
      lost_reason: null,
      lost_notes: null,
      actual_close_date: null,
    });
    expect(result.afterValues).toEqual({
      stage: "lost",
      lost_reason: "operator_no_response",
      lost_notes:
        "Guarded lifecycle approval: customer inbound went unanswered past the no-response window.",
      actual_close_date: "2026-05-27",
    });
    expect(rpcCall.args.p_before_values).toEqual(result.beforeValues);
    expect(rpcCall.args.p_after_values).toEqual(result.afterValues);
    expect(JSON.stringify(rpcCall.args)).not.toContain("updated_at");
  });

  it("skips operator no-response lost for new_lead and qualifying", async () => {
    for (const stage of ["new_lead", "qualifying"]) {
      const state: TableState = {
        opportunity_follow_up_drafts: [],
        opportunity_lifecycle_state: [],
        notifications: [],
        opportunities: [
          {
            id: "opp-1",
            company_id: "company-1",
            stage,
            archived_at: null,
            deleted_at: null,
            project_id: null,
            project_ref: null,
          },
        ],
        opportunity_lifecycle_action_audit: [],
      };

      const result = await executeOpportunityLifecycleAction(
        makeInput(
          {
            decision: makeDecision("move_to_lost_operator_no_response"),
            approvedActionKey: "opp-1:move_to_lost_operator_no_response:approved",
            opportunity: {
              id: "opp-1",
              companyId: "company-1",
              stage,
              archivedAt: null,
              deletedAt: null,
              projectId: null,
              projectRef: null,
            },
          } as Partial<OpportunityLifecycleActionInput> & Record<string, unknown>,
          state
        )
      );

      expect(result.applied).toBe(false);
      expect(result.skippedReason).toBe("lost_stage_not_allowed");
      expect(state.opportunities?.[0].stage).toBe(stage);
    }
  });

  it("skips terminal, deleted, and converted/project-linked destructive mutations", async () => {
    const cases: Array<{
      stage: string;
      skippedReason: string;
      deletedAt?: string;
      projectId?: string;
      projectRef?: string;
    }> = [
      { stage: "won", skippedReason: "terminal_or_protected_stage" },
      { stage: "lost", skippedReason: "terminal_or_protected_stage" },
      { stage: "discarded", skippedReason: "terminal_or_protected_stage" },
      {
        stage: "follow_up",
        deletedAt: "2026-05-20T18:00:00.000Z",
        skippedReason: "deleted_opportunity",
      },
      {
        stage: "follow_up",
        projectId: "project-1",
        skippedReason: "converted_or_project_linked",
      },
      {
        stage: "follow_up",
        projectRef: "project-ref-1",
        skippedReason: "converted_or_project_linked",
      },
    ];

    for (const item of cases) {
      const state: TableState = {
        opportunity_follow_up_drafts: [],
        opportunity_lifecycle_state: [],
        notifications: [],
        opportunities: [
          {
            id: "opp-1",
            company_id: "company-1",
            stage: item.stage,
            archived_at: null,
            deleted_at: item.deletedAt ?? null,
            project_id: item.projectId ?? null,
            project_ref: item.projectRef ?? null,
          },
        ],
        opportunity_lifecycle_action_audit: [],
      };

      const result = await executeOpportunityLifecycleAction(
        makeInput(
          {
            decision: makeDecision("archive_no_meaningful_correspondence"),
            approvedActionKey: "opp-1:archive_no_meaningful_correspondence:approved",
            opportunity: {
              id: "opp-1",
              companyId: "company-1",
              stage: item.stage,
              archivedAt: null,
              deletedAt: item.deletedAt ?? null,
              projectId: item.projectId ?? null,
              projectRef: item.projectRef ?? null,
            },
          } as Partial<OpportunityLifecycleActionInput> & Record<string, unknown>,
          state
        )
      );

      expect(result.applied).toBe(false);
      expect(result.skippedReason).toBe(item.skippedReason);
      expect(state.opportunities?.[0].archived_at).toBeNull();
    }
  });

  it("reactivates by clearing archived_at only when a related meaningful inbound exists", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
      opportunities: [
        {
          id: "opp-1",
          company_id: "company-1",
          stage: "follow_up",
          archived_at: "2026-05-20T18:00:00.000Z",
          deleted_at: null,
          project_id: null,
          project_ref: null,
          lost_reason: null,
          lost_notes: null,
          actual_close_date: null,
        },
      ],
      opportunity_lifecycle_action_audit: [],
    };

    const input = makeInput(
      {
        decision: makeDecision("reactivate_on_related_inbound", {
          latestEventId: "event-in-1",
        }),
        latestMeaningfulEvent: {
          id: "event-in-1",
          direction: "inbound",
          isMeaningful: true,
          occurredAt: "2026-05-27T17:00:00.000Z",
          providerThreadId: "thread-2",
          linkedContactKind: "related_contact",
        },
        now: new Date("2026-05-27T18:00:00.000Z"),
        approvedActionKey: "opp-1:reactivate_on_related_inbound:approved",
        opportunity: {
          id: "opp-1",
          companyId: "company-1",
          stage: "follow_up",
          archivedAt: "2026-05-20T18:00:00.000Z",
          deletedAt: null,
          projectId: null,
          projectRef: null,
          lostReason: null,
          lostNotes: null,
          actualCloseDate: null,
        },
      } as Partial<OpportunityLifecycleActionInput> & Record<string, unknown>,
      state
    );

    const result = await executeOpportunityLifecycleAction(input);

    expect(result.operations.opportunity).toBe("reactivated");
    expect(result.beforeValues).toEqual({
      archived_at: "2026-05-20T18:00:00.000Z",
    });
    expect(result.afterValues).toEqual({ archived_at: null });
    const rpcCall = (input.supabase as ReturnType<typeof makeSupabaseDouble>).rpcCalls[0];
    expect(rpcCall.args.p_before_values).toEqual(result.beforeValues);
    expect(rpcCall.args.p_after_values).toEqual(result.afterValues);
    expect(JSON.stringify(rpcCall.args)).not.toContain("updated_at");
    expect(state.opportunities?.[0]).toMatchObject({
      stage: "follow_up",
      archived_at: "2026-05-20T18:00:00.000Z",
      lost_reason: null,
      lost_notes: null,
      actual_close_date: null,
    });
  });

  it("does not leave an opportunity mutation when the atomic audit RPC fails", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
      opportunities: [
        {
          id: "opp-1",
          company_id: "company-1",
          stage: "follow_up",
          archived_at: null,
          deleted_at: null,
          project_id: null,
          project_ref: null,
        },
      ],
      opportunity_lifecycle_action_audit: [],
    };

    const result = await executeOpportunityLifecycleAction(
      makeInput(
        {
          decision: makeDecision("archive_no_meaningful_correspondence"),
          approvedActionKey: "opp-1:archive_no_meaningful_correspondence:approved",
          opportunity: {
            id: "opp-1",
            companyId: "company-1",
            stage: "follow_up",
            archivedAt: null,
            deletedAt: null,
            projectId: null,
            projectRef: null,
          },
        } as Partial<OpportunityLifecycleActionInput> & Record<string, unknown>,
        state,
        { failGuardedActionRpc: true }
      )
    );

    expect(result.applied).toBe(false);
    expect(result.skippedReason).toBe("audit_insert_failed");
    expect(state.opportunities?.[0].archived_at).toBeNull();
    expect(state.opportunity_lifecycle_action_audit).toHaveLength(0);
  });

  it("skips reactivation for terminal, deleted, and unrelated inbound rows", async () => {
    const cases: Array<{
      stage: string;
      archivedAt: string;
      skippedReason: string;
      linkedContactKind: string;
      deletedAt?: string;
    }> = [
      {
        stage: "won",
        archivedAt: "2026-05-20T18:00:00.000Z",
        skippedReason: "terminal_or_protected_stage",
        linkedContactKind: "related_contact",
      },
      {
        stage: "lost",
        archivedAt: "2026-05-20T18:00:00.000Z",
        skippedReason: "terminal_or_protected_stage",
        linkedContactKind: "related_contact",
      },
      {
        stage: "discarded",
        archivedAt: "2026-05-20T18:00:00.000Z",
        skippedReason: "terminal_or_protected_stage",
        linkedContactKind: "related_contact",
      },
      {
        stage: "follow_up",
        archivedAt: "2026-05-20T18:00:00.000Z",
        deletedAt: "2026-05-25T18:00:00.000Z",
        skippedReason: "deleted_opportunity",
        linkedContactKind: "related_contact",
      },
      {
        stage: "follow_up",
        archivedAt: "2026-05-20T18:00:00.000Z",
        skippedReason: "missing_related_inbound",
        linkedContactKind: "customer",
      },
    ];

    for (const item of cases) {
      const state: TableState = {
        opportunity_follow_up_drafts: [],
        opportunity_lifecycle_state: [],
        notifications: [],
        opportunities: [
          {
            id: "opp-1",
            company_id: "company-1",
            stage: item.stage,
            archived_at: item.archivedAt,
            deleted_at: item.deletedAt ?? null,
            project_id: null,
            project_ref: null,
          },
        ],
        opportunity_lifecycle_action_audit: [],
      };

      const result = await executeOpportunityLifecycleAction(
        makeInput(
          {
            decision: makeDecision("reactivate_on_related_inbound"),
            latestMeaningfulEvent: {
              id: "event-in-1",
              direction: "inbound",
              isMeaningful: true,
              occurredAt: "2026-05-27T17:00:00.000Z",
              providerThreadId: "thread-2",
              linkedContactKind: item.linkedContactKind,
            },
            approvedActionKey: "opp-1:reactivate_on_related_inbound:approved",
            opportunity: {
              id: "opp-1",
              companyId: "company-1",
              stage: item.stage,
              archivedAt: item.archivedAt,
              deletedAt: item.deletedAt ?? null,
              projectId: null,
              projectRef: null,
            },
          } as Partial<OpportunityLifecycleActionInput> & Record<string, unknown>,
          state
        )
      );

      expect(result.applied).toBe(false);
      expect(result.skippedReason).toBe(item.skippedReason);
      expect(state.opportunities?.[0].archived_at).toBe(item.archivedAt);
    }
  });

  it("dry-run destructive execution reports planned mutation without writing", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
      opportunities: [
        {
          id: "opp-1",
          company_id: "company-1",
          stage: "follow_up",
          archived_at: null,
          deleted_at: null,
          project_id: null,
          project_ref: null,
        },
      ],
      opportunity_lifecycle_action_audit: [],
    };

    const result = await executeOpportunityLifecycleAction(
      makeInput(
        {
          mode: "dry-run",
          decision: makeDecision("archive_no_meaningful_correspondence"),
          opportunity: {
            id: "opp-1",
            companyId: "company-1",
            stage: "follow_up",
            archivedAt: null,
            deletedAt: null,
            projectId: null,
            projectRef: null,
          },
        } as Partial<OpportunityLifecycleActionInput> & Record<string, unknown>,
        state
      )
    );

    expect(result.applied).toBe(false);
    expect(result.operations.opportunity).toBe("would_archive");
    expect(result.operations.audit).toBe("would_record");
    expect(state.opportunities?.[0].archived_at).toBeNull();
    expect(state.opportunity_lifecycle_action_audit).toHaveLength(0);
  });

  it("requires an exact approved action key before destructive apply", async () => {
    const state: TableState = {
      opportunity_follow_up_drafts: [],
      opportunity_lifecycle_state: [],
      notifications: [],
      opportunities: [
        {
          id: "opp-1",
          company_id: "company-1",
          stage: "follow_up",
          archived_at: null,
          deleted_at: null,
          project_id: null,
          project_ref: null,
        },
      ],
      opportunity_lifecycle_action_audit: [],
    };

    const result = await executeOpportunityLifecycleAction(
      makeInput(
        {
          decision: makeDecision("archive_no_meaningful_correspondence"),
          opportunity: {
            id: "opp-1",
            companyId: "company-1",
            stage: "follow_up",
            archivedAt: null,
            deletedAt: null,
            projectId: null,
            projectRef: null,
          },
        } as Partial<OpportunityLifecycleActionInput> & Record<string, unknown>,
        state
      )
    );

    expect(result.applied).toBe(false);
    expect(result.skippedReason).toBe("missing_approval");
    expect(state.opportunities?.[0].archived_at).toBeNull();
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
