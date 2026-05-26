import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectStatus } from "@/lib/types/models";
import { ProjectTableService } from "@/lib/api/services/project-table-service";
import { requireSupabase } from "@/lib/supabase/helpers";

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
}));

function directUpdateSupabaseMock(result: {
  data: { updated_at: string } | null;
  error: null | { code?: string; message: string };
}) {
  const maybeSingle = vi.fn(async () => result);
  const select = vi.fn(() => ({ maybeSingle }));
  const eqUpdatedAt = vi.fn(() => ({ select }));
  const eqId = vi.fn(() => ({ eq: eqUpdatedAt }));
  const update = vi.fn(() => ({ eq: eqId }));
  const from = vi.fn(() => ({ update }));
  return { from, update, eqId, eqUpdatedAt, select, maybeSingle };
}

function rpcSupabaseMock(result: {
  data: unknown;
  error: null | { code?: string; message: string };
}) {
  return { rpc: vi.fn(async () => result) };
}

describe("ProjectTableService mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates direct project fields with an updated_at match", async () => {
    const mock = directUpdateSupabaseMock({
      data: { updated_at: "2026-05-13T01:00:00Z" },
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableService.updateProjectField({
      projectId: "p-1",
      columnId: "name",
      value: "New name",
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    })).resolves.toEqual({ updatedAt: "2026-05-13T01:00:00Z" });

    expect(mock.from).toHaveBeenCalledWith("projects");
    expect(mock.update).toHaveBeenCalledWith({ title: "New name" });
    expect(mock.eqId).toHaveBeenCalledWith("id", "p-1");
    expect(mock.eqUpdatedAt).toHaveBeenCalledWith("updated_at", "2026-05-13T00:00:00Z");
  });

  it("updates project client through the direct optimistic field path", async () => {
    const mock = directUpdateSupabaseMock({
      data: { updated_at: "2026-05-13T01:00:00Z" },
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableService.updateProjectField({
      projectId: "p-1",
      columnId: "client",
      value: { clientId: "client-2", clientName: "Maverick Projects" },
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    })).resolves.toEqual({ updatedAt: "2026-05-13T01:00:00Z" });

    expect(mock.update).toHaveBeenCalledWith({ client_id: "client-2" });
  });

  it("turns zero-row direct updates into conflict errors", async () => {
    const mock = directUpdateSupabaseMock({ data: null, error: null });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableService.updateProjectField({
      projectId: "p-1",
      columnId: "address",
      value: "New address",
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    })).rejects.toMatchObject({ code: "P0001" });
  });

  it("changes status through the canonical RPC", async () => {
    const mock = rpcSupabaseMock({
      data: { updated_at: "2026-05-13T01:00:00Z", to_status: "in_progress" },
      error: null,
    });
    vi.mocked(requireSupabase).mockReturnValue(mock as never);

    await expect(ProjectTableService.changeProjectStatus({
      projectId: "p-1",
      status: ProjectStatus.InProgress,
      expectedUpdatedAt: "2026-05-13T00:00:00Z",
    })).resolves.toEqual({ updatedAt: "2026-05-13T01:00:00Z" });

    expect(mock.rpc).toHaveBeenCalledWith("change_project_status", {
      p_project_id: "p-1",
      p_new_status: "in_progress",
      p_expected_updated_at: "2026-05-13T00:00:00Z",
    });
  });
});
