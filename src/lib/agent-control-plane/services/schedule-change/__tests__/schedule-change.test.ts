import { describe, expect, it, vi } from "vitest";
import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import { MCP_EXPOSURE_CATALOG, MCP_EXPOSURE_V16, ACTIVE_MCP_EXPOSURE_REVISION } from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";
import { createScheduleChangeRepository, type ScheduleChangeRpcClient, scheduleInstantMicros } from "../schedule-change-repository";
import { createScheduleChangeService } from "../schedule-change-service";
import { actorFixture, resultFixture, REQUEST, PROOF, ACTOR_ID, COMPANY_ID } from "./fixtures";

describe("schedule change domain boundary", () => {
  it("remains absent from selectable discovery and preserves the active exposure", () => {
    expect(MCP_EXPOSURE_CATALOG[MCP_EXPOSURE_V16.revision]).toBeUndefined();
    expect(ACTIVE_MCP_EXPOSURE_REVISION).toBe("2026-09-04.mcp-exposure.v14");
    expect(MCP_EXPOSURE_V16.toolIds).not.toContain("prepare_customer_message");
    expect(MCP_EXPOSURE_V16.toolIds).not.toContain("commit_schedule_change");
  });
  it("compares exact microseconds across equivalent offsets", () => {
    expect(scheduleInstantMicros("2026-09-06T12:00:00.123456Z")).toBe(scheduleInstantMicros("2026-09-06T05:00:00.123456-07:00"));
    expect(scheduleInstantMicros("2026-09-06T12:00:00.123456Z")).not.toBe(scheduleInstantMicros("2026-09-06T12:00:00.123457Z"));
  });
  it("reauthorizes and verifies timezone parity before creating the proposal", async () => {
    const { actor, authorityClient } = await actorFixture();
    const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>((name) => Promise.resolve({ data: name.startsWith("inspect_") ? PROOF : resultFixture(), error: null }));
    const service = createScheduleChangeService({ repository: createScheduleChangeRepository({ rpc }), authorityRepository: authorityClient.repository });
    expect((await service.prepareScheduleChange(actor, REQUEST)).proposal.tasks).toHaveLength(1);
    expect(authorityClient.actorLookups).toHaveLength(1);
    expect(rpc.mock.calls.map(call => call[0])).toEqual(["inspect_agent_schedule_change_as_system", "prepare_agent_schedule_change_as_system"]);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_actor_user_id: ACTOR_ID, p_company_id: COMPANY_ID, p_request: REQUEST, p_timezone_proof: PROOF, p_capability_manifest_revision: "2026-09-06.capability-manifest.v22", p_exposure_revision: "2026-09-06.mcp-exposure.v16" });
  });
  it("does not create an approval when database timezone rules are stale", async () => {
    const { actor, authorityClient } = await actorFixture();
    const proof = structuredClone(PROOF); proof.probes[0].instant = "2026-11-02T08:00:00Z";
    const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>(() => Promise.resolve({ data: proof, error: null }));
    const service = createScheduleChangeService({ repository: createScheduleChangeRepository({ rpc }), authorityRepository: authorityClient.repository });
    await expect(service.prepareScheduleChange(actor, REQUEST)).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("rejects missing scope or current assignment authority before reading business sources", async () => {
    for (const fixture of [await actorFixture({ scopes: ["ops.schedule.read"] }), await actorFixture({ permissions: ["agent.review", "tasks.edit"] })]) {
      const rpc = vi.fn<ScheduleChangeRpcClient["rpc"]>();
      const service = createScheduleChangeService({ repository: createScheduleChangeRepository({ rpc }), authorityRepository: fixture.authorityClient.repository });
      await expect(service.prepareScheduleChange(fixture.actor, REQUEST)).rejects.toBeInstanceOf(ActorAccessError);
      expect(rpc).not.toHaveBeenCalled();
    }
  });
  it("rejects validly shaped but substituted task, crew, date or precise source timestamp", async () => {
    for (const mutate of [
      (r: ReturnType<typeof resultFixture>) => { r.proposal.tasks[0].task_id = COMPANY_ID; },
      (r: ReturnType<typeof resultFixture>) => { r.proposal.tasks[0].after.team[0].id = COMPANY_ID; },
      (r: ReturnType<typeof resultFixture>) => { r.proposal.tasks[0].after.local_start = "2026-11-03T00:00:00"; },
      (r: ReturnType<typeof resultFixture>) => { r.proposal.tasks[0].before.updated_at = "2026-09-06T12:00:00.123457Z"; },
      (r: ReturnType<typeof resultFixture>) => { r.proposal.reason = "Different instruction"; },
      (r: ReturnType<typeof resultFixture>) => { r.proposal.timezone = "UTC"; },
      (r: ReturnType<typeof resultFixture>) => { r.proposal.tasks[0].after.end_date = "2026-11-05T07:00:00Z"; },
      (r: ReturnType<typeof resultFixture>) => { r.proposal.tasks[0].after.local_end_exclusive = "2026-11-05T00:00:00"; },
    ]) {
      const { actor } = await actorFixture(); const output = resultFixture(); mutate(output);
      const repository = createScheduleChangeRepository({ rpc: name => Promise.resolve({ data: name.startsWith("inspect_") ? PROOF : output, error: null }) });
      await expect(repository.prepare({ actorContext: actor, request: REQUEST, observedAt: "2026-09-06T12:00:00Z" })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    }
  });
});
