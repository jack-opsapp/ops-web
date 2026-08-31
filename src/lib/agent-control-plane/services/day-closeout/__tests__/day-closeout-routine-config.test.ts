import { describe, expect, it, vi } from "vitest";

import {
  DayCloseoutRoutineConfigStoreError,
  listDayCloseoutRoutineConfigs,
  upsertDayCloseoutRoutineConfig,
} from "../day-closeout-routine-config";

const ACTOR_ID = "dc000000-0000-4000-8000-000000000011";
const COMPANY_ID = "dc000000-0000-4000-8000-000000000001";
const GRANT_ID = "dc000000-0000-4000-8000-000000000031";
const CLIENT_ID = "dc000000-0000-4000-8000-000000000021";

const ROW = {
  grant_id: GRANT_ID,
  client_id: CLIENT_ID,
  client_name: "Claude",
  enabled: false,
  local_time: "20:00",
  timezone: "America/Vancouver",
  next_run_at: null,
  last_run_at: null,
  last_success_at: null,
  last_failure_code: null,
  schedule_revision: 0,
};

describe("day-closeout routine configuration repository", () => {
  it("lists only through the current actor and company RPC arguments", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [ROW], error: null });

    await expect(
      listDayCloseoutRoutineConfigs(
        { rpc },
        {
          actorUserId: ACTOR_ID,
          companyId: COMPANY_ID,
        }
      )
    ).resolves.toEqual([
      {
        grantId: GRANT_ID,
        clientId: CLIENT_ID,
        clientName: "Claude",
        enabled: false,
        localTime: "20:00",
        timezone: "America/Vancouver",
        nextRunAt: null,
        lastRunAt: null,
        lastSuccessAt: null,
        lastFailureCode: null,
        scheduleRevision: 0,
      },
    ]);

    expect(rpc).toHaveBeenCalledWith(
      "list_agent_day_closeout_routine_configs_as_system",
      { p_actor_user_id: ACTOR_ID, p_company_id: COMPANY_ID }
    );
  });

  it("upserts only one exact grant, switch state, and canonical local time", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...ROW, enabled: true, local_time: "21:15" }],
      error: null,
    });

    const result = await upsertDayCloseoutRoutineConfig(
      { rpc },
      {
        actorUserId: ACTOR_ID,
        companyId: COMPANY_ID,
        grantId: GRANT_ID,
        enabled: true,
        localTime: "21:15",
      }
    );

    expect(result.enabled).toBe(true);
    expect(result.localTime).toBe("21:15");
    expect(rpc).toHaveBeenCalledWith(
      "upsert_agent_day_closeout_routine_config_as_system",
      {
        p_actor_user_id: ACTOR_ID,
        p_company_id: COMPANY_ID,
        p_oauth_grant_id: GRANT_ID,
        p_enabled: true,
        p_local_time: "21:15",
      }
    );
  });

  it("fails closed on malformed rows instead of partially trusting them", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...ROW, schedule_revision: -1 }],
      error: null,
    });

    await expect(
      listDayCloseoutRoutineConfigs(
        { rpc },
        {
          actorUserId: ACTOR_ID,
          companyId: COMPANY_ID,
        }
      )
    ).rejects.toMatchObject({
      name: "DayCloseoutRoutineConfigStoreError",
      kind: "unavailable",
    });
  });

  it("preserves only the authorization class of database failures", async () => {
    const deniedRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42501", message: "private details" },
    });
    const failedRpc = vi.fn().mockRejectedValue(new Error("network details"));

    await expect(
      listDayCloseoutRoutineConfigs(
        { rpc: deniedRpc },
        {
          actorUserId: ACTOR_ID,
          companyId: COMPANY_ID,
        }
      )
    ).rejects.toEqual(
      expect.objectContaining<Partial<DayCloseoutRoutineConfigStoreError>>({
        kind: "forbidden",
      })
    );
    await expect(
      listDayCloseoutRoutineConfigs(
        { rpc: failedRpc },
        {
          actorUserId: ACTOR_ID,
          companyId: COMPANY_ID,
        }
      )
    ).rejects.toEqual(
      expect.objectContaining<Partial<DayCloseoutRoutineConfigStoreError>>({
        kind: "unavailable",
      })
    );
  });
});
