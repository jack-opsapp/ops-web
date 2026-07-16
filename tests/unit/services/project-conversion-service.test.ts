/**
 * ProjectConversionService — the single canonical opportunity → project
 * conversion path. Post won-conversion-unification, the service is a thin,
 * atomic wrapper over two database RPCs:
 *   - get_conversion_preflight   (read-only dedup + suggested name)
 *   - convert_opportunity_to_project (the superset write txn — wins, creates
 *     OR links, relinks estimates, materializes tasks/photos, dispositions)
 *
 * These tests assert the TS CONTRACT only (no live DB):
 *   - the unified RPC is called with correctly-mapped args (NO bare-project
 *     pre-create, NO orphan-cleanup dance — the RPC is atomic);
 *   - win is derived from the source path (won_dialog ⇒ win, approval_queue ⇒
 *     create-without-winning);
 *   - idempotency / snapshot guards map to the right result / throw;
 *   - a successful CREATE fires the rail notification; a LINK-existing does not;
 *   - preflight snake_case → camelCase mapping.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const requireSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
}));

const notifyMock = vi.fn(async (_params: Record<string, unknown>) => {});
vi.mock("@/lib/api/services/notification-service", () => ({
  NotificationService: {
    create: (params: Record<string, unknown>) => notifyMock(params),
  },
}));

import { ProjectConversionService } from "@/lib/api/services/project-conversion-service";

type Row = Record<string, unknown>;

interface FakeOpts {
  /** Per-RPC-name canned result. Falls back to a generic convert success. */
  rpc?: Record<string, { data: unknown; error: unknown }>;
  /** Title returned by the minimal opportunity read used for the notification. */
  oppTitle?: string | null;
}

function makeFakeSupabase(opts: FakeOpts = {}) {
  const rpcCalls: Array<{ name: string; args: Row }> = [];

  function from(_table: string) {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({
        data: { title: opts.oppTitle ?? "Roof job" },
        error: null,
      }),
      single: async () => ({
        data: { title: opts.oppTitle ?? "Roof job" },
        error: null,
      }),
    });
    return builder;
  }

  const client = {
    from,
    rpc: async (name: string, args: Row) => {
      rpcCalls.push({ name, args });
      const canned = opts.rpc?.[name];
      if (canned) return canned;
      if (name === "convert_opportunity_to_project") {
        return {
          data: {
            converted: true,
            already_converted: false,
            project_id: "proj-new",
            opportunity_id: args.p_opportunity_id,
            disposition_id: "disp-1",
            relinked_estimates: 2,
            materialized_tasks: 3,
            attached_photos: 1,
            linked_existing: args.p_link_to_project_id != null,
            won: args.p_win_opportunity === true,
          },
          error: null,
        };
      }
      return { data: {}, error: null };
    },
  };
  return { client, rpcCalls };
}

const COMPANY = "co-1";
const OPP = "opp-1";
const OPERATOR = "user-1";

beforeEach(() => {
  requireSupabaseMock.mockReset();
  notifyMock.mockClear();
});

describe("convertOpportunityToProject — unified RPC contract", () => {
  it("calls convert_opportunity_to_project (not the legacy guarded RPC) with mapped args; no pre-create", async () => {
    const fake = makeFakeSupabase();
    requireSupabaseMock.mockReturnValue(fake.client);

    const result = await ProjectConversionService.convertOpportunityToProject({
      opportunityId: OPP,
      companyId: COMPANY,
      decidedBy: OPERATOR,
      sourcePath: "won_dialog",
      expectedStage: "proposal",
      actualValue: 1234,
    });

    const convertCalls = fake.rpcCalls.filter(
      (c) => c.name === "convert_opportunity_to_project"
    );
    expect(convertCalls).toHaveLength(1);
    // the legacy guarded RPC must never be called.
    expect(
      fake.rpcCalls.some(
        (c) => c.name === "execute_opportunity_project_conversion_guarded"
      )
    ).toBe(false);

    expect(convertCalls[0].args).toMatchObject({
      p_company_id: COMPANY,
      p_opportunity_id: OPP,
      p_actual_value: 1234,
      p_expected_stage: "proposal",
      p_decided_by: OPERATOR,
      p_source_path: "won_dialog",
      p_win_opportunity: true,
      p_title_override: null,
      p_link_to_project_id: null,
    });

    expect(result.converted).toBe(true);
    expect(result.alreadyConverted).toBe(false);
    expect(result.projectId).toBe("proj-new");
    expect(result.relinkedEstimates).toBe(2);
    expect(result.materializedTasks).toBe(3);
    expect(result.attachedPhotos).toBe(1);
    expect(result.won).toBe(true);
    expect(result.linkedExisting).toBe(false);
    // success → rail notification fired once.
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it("approval_queue source creates WITHOUT winning the opportunity (p_win_opportunity=false)", async () => {
    const fake = makeFakeSupabase();
    requireSupabaseMock.mockReturnValue(fake.client);

    await ProjectConversionService.convertOpportunityToProject({
      opportunityId: OPP,
      companyId: COMPANY,
      decidedBy: OPERATOR,
      sourcePath: "approval_queue",
      notesSeed: "AI scope text",
    });

    const args = fake.rpcCalls[0].args;
    expect(args.p_win_opportunity).toBe(false);
    expect(args.p_source_path).toBe("approval_queue");
    expect(args.p_notes).toBe("AI scope text");
  });

  it("deterministic email acceptance converts and wins through the canonical RPC", async () => {
    const fake = makeFakeSupabase();
    requireSupabaseMock.mockReturnValue(fake.client);

    const result = await ProjectConversionService.convertOpportunityToProject({
      opportunityId: OPP,
      companyId: COMPANY,
      decidedBy: null,
      sourcePath: "email_accept",
      expectedStage: "quoted",
      expectedAssignmentVersion: 4,
      evidence: {
        connection_id: "connection-1",
        email_thread_id: "thread-1",
        provider_thread_id: "provider-thread-1",
        decision: "auto_advance_won",
      },
    });

    expect(fake.rpcCalls[0].args).toMatchObject({
      p_decided_by: null,
      p_source_path: "email_accept",
      p_win_opportunity: true,
      p_expected_stage: "quoted",
      p_expected_assignment_version: 4,
      p_evidence: {
        connection_id: "connection-1",
        email_thread_id: "thread-1",
        provider_thread_id: "provider-thread-1",
        decision: "auto_advance_won",
      },
    });
    expect(result.won).toBe(true);
  });

  it("binds likely-won conversion to actorless provider-message evidence", async () => {
    const fake = makeFakeSupabase();
    requireSupabaseMock.mockReturnValue(fake.client);

    await ProjectConversionService.convertOpportunityToProject({
      opportunityId: OPP,
      companyId: COMPANY,
      decidedBy: null,
      sourcePath: "email_likely_won",
      expectedAssignmentVersion: 9,
      evidence: {
        connection_id: "connection-1",
        provider_thread_id: "provider-thread-1",
        provider_message_id: "provider-message-1",
        decision: "likely_won",
      },
    });

    expect(fake.rpcCalls[0].args).toMatchObject({
      p_decided_by: null,
      p_source_path: "email_likely_won",
      p_expected_assignment_version: 9,
      p_evidence: {
        connection_id: "connection-1",
        provider_thread_id: "provider-thread-1",
        provider_message_id: "provider-message-1",
        decision: "likely_won",
      },
    });
  });

  it("fails closed before RPC when actorless email evidence is missing", async () => {
    const fake = makeFakeSupabase();
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      ProjectConversionService.convertOpportunityToProject({
        opportunityId: OPP,
        companyId: COMPANY,
        decidedBy: null,
        sourcePath: "email_likely_won",
        expectedAssignmentVersion: 9,
      })
    ).rejects.toThrow(/exact evidence/i);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("rejects connector-user attribution on an email conversion", async () => {
    const fake = makeFakeSupabase();
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      ProjectConversionService.convertOpportunityToProject({
        opportunityId: OPP,
        companyId: COMPANY,
        decidedBy: OPERATOR,
        sourcePath: "email_accept",
        expectedAssignmentVersion: 4,
        evidence: {
          connection_id: "connection-1",
          email_thread_id: "thread-1",
          provider_thread_id: "provider-thread-1",
          decision: "auto_advance_won",
        },
      })
    ).rejects.toThrow(/actorless email conversion/i);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("forwards an operator-typed name as p_title_override (hand-set)", async () => {
    const fake = makeFakeSupabase();
    requireSupabaseMock.mockReturnValue(fake.client);

    await ProjectConversionService.convertOpportunityToProject({
      opportunityId: OPP,
      companyId: COMPANY,
      sourcePath: "won_dialog",
      titleOverride: "Custom name",
    });

    expect(fake.rpcCalls[0].args.p_title_override).toBe("Custom name");
  });
});

describe("convertOpportunityToProject — idempotency + guards", () => {
  it("returns alreadyConverted (no notification) when the RPC reports already_converted", async () => {
    const fake = makeFakeSupabase({
      rpc: {
        convert_opportunity_to_project: {
          data: {
            converted: false,
            already_converted: true,
            guard_reason: "already_converted",
            project_id: "existing-proj",
            won: true,
          },
          error: null,
        },
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    const result = await ProjectConversionService.convertOpportunityToProject({
      opportunityId: OPP,
      companyId: COMPANY,
      decidedBy: OPERATOR,
      sourcePath: "won_dialog",
    });

    expect(result.alreadyConverted).toBe(true);
    expect(result.converted).toBe(false);
    expect(result.projectId).toBe("existing-proj");
    expect(result.won).toBe(true);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("throws on snapshot_mismatch (opportunity changed under the operator)", async () => {
    const fake = makeFakeSupabase({
      rpc: {
        convert_opportunity_to_project: {
          data: {
            converted: false,
            already_converted: false,
            guard_reason: "snapshot_mismatch",
          },
          error: null,
        },
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      ProjectConversionService.convertOpportunityToProject({
        opportunityId: OPP,
        companyId: COMPANY,
        sourcePath: "won_dialog",
        expectedStage: "proposal",
      })
    ).rejects.toThrow(/changed before conversion/i);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("throws on a hard RPC error", async () => {
    const fake = makeFakeSupabase({
      rpc: {
        convert_opportunity_to_project: {
          data: null,
          error: { message: "boom" },
        },
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      ProjectConversionService.convertOpportunityToProject({
        opportunityId: OPP,
        companyId: COMPANY,
        sourcePath: "won_dialog",
      })
    ).rejects.toThrow(/conversion RPC failed/i);
  });
});

describe("linkOpportunityToExistingProject", () => {
  it("calls convert with p_link_to_project_id and does NOT fire a new-project notification", async () => {
    const fake = makeFakeSupabase();
    requireSupabaseMock.mockReturnValue(fake.client);

    const result =
      await ProjectConversionService.linkOpportunityToExistingProject({
        opportunityId: OPP,
        companyId: COMPANY,
        decidedBy: OPERATOR,
        sourcePath: "won_dialog",
        linkToProjectId: "existing-proj",
        actualValue: 500,
      });

    expect(fake.rpcCalls[0].name).toBe("convert_opportunity_to_project");
    expect(fake.rpcCalls[0].args.p_link_to_project_id).toBe("existing-proj");
    expect(fake.rpcCalls[0].args.p_win_opportunity).toBe(true);
    expect(result.linkedExisting).toBe(true);
    // linking an EXISTING project → no "project created" notification.
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe("getConversionPreflight", () => {
  it("maps the snake_case RPC payload into a typed camelCase preflight", async () => {
    const fake = makeFakeSupabase({
      rpc: {
        get_conversion_preflight: {
          data: {
            existing_linked_project: { id: "p-ex", title: "Linked job" },
            duplicate_candidates: [
              {
                project_id: "p-1",
                title: "1240 W 6th Ave",
                address: "1240 W 6th Ave, Vancouver",
                confidence: "high",
                signals: ["same_client", "same_address"],
              },
            ],
            other_client_projects: [
              {
                project_id: "p-2",
                title: "55 Elm",
                address: "55 Elm St",
                status: "in_progress",
              },
            ],
            suggested_name: "1240 W 6th Ave",
          },
          error: null,
        },
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    const preflight = await ProjectConversionService.getConversionPreflight(
      OPP,
      COMPANY
    );

    expect(fake.rpcCalls[0].name).toBe("get_conversion_preflight");
    expect(fake.rpcCalls[0].args).toMatchObject({
      p_opportunity_id: OPP,
      p_company_id: COMPANY,
    });

    expect(preflight.existingLinkedProject).toEqual({
      id: "p-ex",
      title: "Linked job",
    });
    expect(preflight.duplicateCandidates).toEqual([
      {
        projectId: "p-1",
        title: "1240 W 6th Ave",
        address: "1240 W 6th Ave, Vancouver",
        confidence: "high",
        signals: ["same_client", "same_address"],
      },
    ]);
    expect(preflight.otherClientProjects).toEqual([
      {
        projectId: "p-2",
        title: "55 Elm",
        address: "55 Elm St",
        status: "in_progress",
      },
    ]);
    expect(preflight.suggestedName).toBe("1240 W 6th Ave");
  });

  it("normalizes an empty preflight (no hits) to empty arrays + null", async () => {
    const fake = makeFakeSupabase({
      rpc: {
        get_conversion_preflight: {
          data: {
            existing_linked_project: null,
            duplicate_candidates: [],
            other_client_projects: [],
            suggested_name: "New project",
          },
          error: null,
        },
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    const preflight = await ProjectConversionService.getConversionPreflight(
      OPP,
      COMPANY
    );

    expect(preflight.existingLinkedProject).toBeNull();
    expect(preflight.duplicateCandidates).toEqual([]);
    expect(preflight.otherClientProjects).toEqual([]);
    expect(preflight.suggestedName).toBe("New project");
  });
});
