/**
 * ProjectConversionService — the single canonical opportunity → project
 * conversion path (P6). These tests assert the service's contract WITHOUT a
 * live DB (the guarded RPC is exercised by the migration shape test + the
 * operator's apply-time integration run):
 *   - payload fill-blank carries canonical opportunity data (value precedence,
 *     description vs notes, source/platform_metadata seed).
 *   - status selection per source path (won_dialog → accepted, queue → rfq).
 *   - idempotency pre-check: an already-linked opportunity returns the existing
 *     project and creates NOTHING.
 *   - the guarded RPC is called with the four-column-contract args + the
 *     pre-created project id; a snapshot/already-converted race soft-deletes the
 *     orphan project.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const requireSupabaseMock = vi.fn();
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => requireSupabaseMock(),
}));

const createProjectMock = vi.fn(
  async (_payload: Record<string, unknown>) => "proj-new"
);
const deleteProjectMock = vi.fn(async (_id: string) => {});
vi.mock("@/lib/api/services/project-service", () => ({
  ProjectService: {
    createProject: (payload: Record<string, unknown>) =>
      createProjectMock(payload),
    deleteProject: (id: string) => deleteProjectMock(id),
  },
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
  opportunity: Row | null;
  rpc?: (name: string, args: Row) => { data: unknown; error: unknown };
}

function makeFakeSupabase(opts: FakeOpts) {
  const rpcCalls: Array<{ name: string; args: Row }> = [];

  function from(_table: string) {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      eq: () => builder,
      single: async () => ({
        data: opts.opportunity,
        error: opts.opportunity ? null : { message: "not found" },
      }),
    });
    return builder;
  }

  const client = {
    from,
    rpc: async (name: string, args: Row) => {
      rpcCalls.push({ name, args });
      if (opts.rpc) return opts.rpc(name, args);
      return {
        data: {
          converted: true,
          project_id: "proj-new",
          opportunity_id: args.p_opportunity_id,
          disposition_id: "disp-1",
          relinked_estimates: 2,
        },
        error: null,
      };
    },
  };
  return { client, rpcCalls };
}

const COMPANY = "co-1";
const OPP = "opp-1";
const OPERATOR = "user-1";

beforeEach(() => {
  requireSupabaseMock.mockReset();
  createProjectMock.mockClear();
  deleteProjectMock.mockClear();
  notifyMock.mockClear();
  createProjectMock.mockResolvedValue("proj-new");
});

describe("convertOpportunityToProject — payload + status", () => {
  it("carries canonical data; value precedence actualValue ?? actual_value ?? estimated_value", async () => {
    const fake = makeFakeSupabase({
      opportunity: {
        id: OPP,
        company_id: COMPANY,
        title: "Roof job",
        client_id: "cl-1",
        address: "12 Main St",
        description: "Tear-off + re-shingle",
        estimated_value: 8000,
        actual_value: null,
        source: "referral",
        source_email_id: "msg-9",
        stage: "won",
        project_ref: null,
        deleted_at: null,
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await ProjectConversionService.convertOpportunityToProject({
      opportunityId: OPP,
      companyId: COMPANY,
      decidedBy: OPERATOR,
      sourcePath: "won_dialog",
    });

    const payload = createProjectMock.mock.calls[0][0] as Row;
    expect(payload.title).toBe("Roof job");
    expect(payload.clientId).toBe("cl-1");
    expect(payload.address).toBe("12 Main St");
    expect(payload.projectDescription).toBe("Tear-off + re-shingle");
    // no actualValue param, actual_value null → falls back to estimated_value.
    expect(payload.estimatedValue).toBe(8000);
    expect(payload.source).toBe("referral");
    expect(payload.platformMetadata).toEqual({
      source: "referral",
      source_email_id: "msg-9",
    });
    // won-dialog → accepted.
    expect(payload.status).toBe("Accepted");
  });

  it("prefers the operator-entered actualValue over stored values", async () => {
    const fake = makeFakeSupabase({
      opportunity: {
        id: OPP,
        company_id: COMPANY,
        title: "T",
        estimated_value: 8000,
        actual_value: 9000,
        stage: "won",
        project_ref: null,
        deleted_at: null,
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await ProjectConversionService.convertOpportunityToProject({
      opportunityId: OPP,
      companyId: COMPANY,
      sourcePath: "won_dialog",
      actualValue: 9500,
    });

    const payload = createProjectMock.mock.calls[0][0] as Row;
    expect(payload.estimatedValue).toBe(9500);
  });

  it("seeds platform_metadata as null when no source/source_email_id exists", async () => {
    const fake = makeFakeSupabase({
      opportunity: {
        id: OPP,
        company_id: COMPANY,
        title: "T",
        source: null,
        source_email_id: null,
        stage: "won",
        project_ref: null,
        deleted_at: null,
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await ProjectConversionService.convertOpportunityToProject({
      opportunityId: OPP,
      companyId: COMPANY,
      sourcePath: "approval_queue",
    });

    const payload = createProjectMock.mock.calls[0][0] as Row;
    expect(payload.platformMetadata).toBeNull();
    // approval-queue → rfq.
    expect(payload.status).toBe("RFQ");
  });
});

describe("convertOpportunityToProject — guarded RPC contract", () => {
  it("calls the conversion RPC with the pre-created project id + snapshot stage + decided_by", async () => {
    const fake = makeFakeSupabase({
      opportunity: {
        id: OPP,
        company_id: COMPANY,
        title: "T",
        stage: "won",
        project_ref: null,
        deleted_at: null,
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    const result = await ProjectConversionService.convertOpportunityToProject({
      opportunityId: OPP,
      companyId: COMPANY,
      decidedBy: OPERATOR,
      sourcePath: "won_dialog",
      expectedStage: "won",
      actualValue: 1234,
    });

    expect(fake.rpcCalls).toHaveLength(1);
    expect(fake.rpcCalls[0].name).toBe(
      "execute_opportunity_project_conversion_guarded"
    );
    expect(fake.rpcCalls[0].args).toMatchObject({
      p_company_id: COMPANY,
      p_opportunity_id: OPP,
      p_project_id: "proj-new",
      p_expected_stage: "won",
      p_decided_by: OPERATOR,
    });
    expect((fake.rpcCalls[0].args.p_evidence as Row).source_path).toBe(
      "won_dialog"
    );
    expect(result.converted).toBe(true);
    expect(result.projectId).toBe("proj-new");
    expect(result.relinkedEstimates).toBe(2);
    // success → rail notification fired.
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });
});

describe("convertOpportunityToProject — idempotency", () => {
  it("is a no-op when the opportunity is already linked (pre-check, no project created)", async () => {
    const fake = makeFakeSupabase({
      opportunity: {
        id: OPP,
        company_id: COMPANY,
        title: "T",
        stage: "won",
        project_ref: "existing-proj",
        deleted_at: null,
      },
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    const result = await ProjectConversionService.convertOpportunityToProject({
      opportunityId: OPP,
      companyId: COMPANY,
      sourcePath: "won_dialog",
    });

    expect(result.alreadyConverted).toBe(true);
    expect(result.converted).toBe(false);
    expect(result.projectId).toBe("existing-proj");
    // No project minted, no RPC, no orphan.
    expect(createProjectMock).not.toHaveBeenCalled();
    expect(fake.rpcCalls).toHaveLength(0);
    expect(deleteProjectMock).not.toHaveBeenCalled();
  });

  it("soft-deletes the orphan project on an already_converted RPC race", async () => {
    const fake = makeFakeSupabase({
      opportunity: {
        id: OPP,
        company_id: COMPANY,
        title: "T",
        stage: "won",
        project_ref: null,
        deleted_at: null,
      },
      rpc: () => ({
        data: {
          converted: false,
          guard_reason: "already_converted",
          project_id: "winner-proj",
        },
        error: null,
      }),
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    const result = await ProjectConversionService.convertOpportunityToProject({
      opportunityId: OPP,
      companyId: COMPANY,
      sourcePath: "won_dialog",
    });

    expect(result.alreadyConverted).toBe(true);
    expect(result.projectId).toBe("winner-proj");
    // the loser's freshly-created project is soft-deleted.
    expect(deleteProjectMock).toHaveBeenCalledWith("proj-new");
  });

  it("soft-deletes the orphan + throws on a hard RPC error (no half-conversion left behind)", async () => {
    const fake = makeFakeSupabase({
      opportunity: {
        id: OPP,
        company_id: COMPANY,
        title: "T",
        stage: "won",
        project_ref: null,
        deleted_at: null,
      },
      rpc: () => ({ data: null, error: { message: "boom" } }),
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      ProjectConversionService.convertOpportunityToProject({
        opportunityId: OPP,
        companyId: COMPANY,
        sourcePath: "won_dialog",
      })
    ).rejects.toThrow(/conversion RPC failed/i);
    expect(deleteProjectMock).toHaveBeenCalledWith("proj-new");
  });

  it("soft-deletes the orphan + throws on snapshot_mismatch", async () => {
    const fake = makeFakeSupabase({
      opportunity: {
        id: OPP,
        company_id: COMPANY,
        title: "T",
        stage: "won",
        project_ref: null,
        deleted_at: null,
      },
      rpc: () => ({
        data: { converted: false, guard_reason: "snapshot_mismatch" },
        error: null,
      }),
    });
    requireSupabaseMock.mockReturnValue(fake.client);

    await expect(
      ProjectConversionService.convertOpportunityToProject({
        opportunityId: OPP,
        companyId: COMPANY,
        sourcePath: "won_dialog",
        expectedStage: "won",
      })
    ).rejects.toThrow(/changed before conversion/i);
    expect(deleteProjectMock).toHaveBeenCalledWith("proj-new");
  });
});
