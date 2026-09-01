import { describe, expect, it, vi } from "vitest";

import {
  createHiringWhatIfRepository,
  HiringWhatIfRepositoryUnavailableError,
  type HiringWhatIfRpcClient,
} from "../hiring-what-if-repository";
import {
  HIRING_CLIENT_ID,
  HIRING_COMPANY_ID,
  HIRING_GRANT_ID,
  HIRING_SCOPES,
  HIRING_USER_ID,
  hiringActorFixture,
  hiringSourceFixture,
} from "./fixtures";

describe("hiring what-if repository", () => {
  it("makes one abortable service-role read with the exact v11/v5 actor binding", async () => {
    const { actor } = await hiringActorFixture();
    const source = hiringSourceFixture();
    const signal = new AbortController().signal;
    const abortSignal = vi.fn(async () => ({ data: source, error: null }));
    const rpc = vi.fn<HiringWhatIfRpcClient["rpc"]>(() =>
      Object.assign(Promise.resolve({ data: source, error: null }), {
        abortSignal,
      })
    );
    const repository = createHiringWhatIfRepository({ rpc });

    await expect(
      repository.readSourceSnapshot({
        actorContext: actor,
        role: "Installer",
        observedAt: "2026-09-01T04:00:00.000Z",
        signal,
      })
    ).resolves.toEqual(source);
    expect(rpc).toHaveBeenCalledWith("read_agent_hiring_what_if_as_system", {
      p_actor_user_id: HIRING_USER_ID,
      p_company_id: HIRING_COMPANY_ID,
      p_oauth_grant_id: HIRING_GRANT_ID,
      p_oauth_client_id: HIRING_CLIENT_ID,
      p_grant_revision: "b".repeat(32),
      p_granted_scope_ceiling: HIRING_SCOPES,
      p_permission_snapshot_revision: `sha256:${"a".repeat(64)}`,
      p_capability_manifest_revision: "2026-08-31.capability-manifest.v11",
      p_exposure_revision: "2026-08-31.mcp-exposure.v5",
      p_role: "Installer",
      p_observed_at: "2026-09-01T04:00:00.000Z",
      p_window_weeks: 13,
      p_member_limit: 25,
      p_schedule_source_limit: 5_001,
      p_financial_source_limit: 5_001,
      p_project_limit: 251,
      p_supporting_record_limit: 100,
    });
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("rejects non-v11 actors, storage errors, and malformed source rows", async () => {
    const { actor } = await hiringActorFixture();
    const failing = createHiringWhatIfRepository({
      rpc: () => Promise.resolve({ data: null, error: { code: "XX000" } }),
    });
    await expect(
      failing.readSourceSnapshot({
        actorContext: actor,
        role: "Installer",
        observedAt: "2026-09-01T04:00:00.000Z",
      })
    ).rejects.toThrow("Hiring analysis source is unavailable");

    const malformed = createHiringWhatIfRepository({
      rpc: () => Promise.resolve({ data: { state: "anything" }, error: null }),
    });
    await expect(
      malformed.readSourceSnapshot({
        actorContext: actor,
        role: "Installer",
        observedAt: "2026-09-01T04:00:00.000Z",
      })
    ).rejects.toBeInstanceOf(HiringWhatIfRepositoryUnavailableError);

    const shiftedClock = createHiringWhatIfRepository({
      rpc: () =>
        Promise.resolve({
          data: {
            ...hiringSourceFixture(),
            observed_at: "2026-09-01T04:00:01.000Z",
          },
          error: null,
        }),
    });
    await expect(
      shiftedClock.readSourceSnapshot({
        actorContext: actor,
        role: "Installer",
        observedAt: "2026-09-01T04:00:00.000Z",
      })
    ).rejects.toBeInstanceOf(HiringWhatIfRepositoryUnavailableError);
    await expect(
      malformed.readSourceSnapshot({
        actorContext: { ...actor, capabilityManifestRevision: "wrong" },
        role: "Installer",
        observedAt: "2026-09-01T04:00:00.000Z",
      })
    ).rejects.toThrow("Hiring analysis requires a v11 MCP actor");
  });
});
