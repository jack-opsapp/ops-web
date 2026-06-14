import { describe, it, expect, vi, beforeEach } from "vitest";

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({ from: () => ({ insert }) }),
}));

import {
  buildAnalyticsEvent,
  dispatchWizardEvent,
  WIZARD_ID,
} from "./analytics";

const base = {
  companyId: "co-1",
  userId: "u-1",
  sessionId: "cw_abc",
  totalSteps: 4,
};

describe("buildAnalyticsEvent", () => {
  it("builds a 'shown' row with the wizard id + platform web", () => {
    const row = buildAnalyticsEvent({
      ...base,
      event: "shown",
      triggerType: "first_run_takeover",
      triggerContext: "catalog_0_0",
    });
    expect(row).toMatchObject({
      wizard_id: WIZARD_ID,
      platform: "web",
      event: "shown",
      company_id: "co-1",
      user_id: "u-1",
      session_id: "cw_abc",
      trigger_type: "first_run_takeover",
      trigger_context: "catalog_0_0",
      total_steps: 4,
    });
  });

  it("includes step_id/step_index for step_completed", () => {
    const row = buildAnalyticsEvent({
      ...base,
      event: "step_completed",
      stepId: "SELL",
      stepIndex: 0,
    });
    expect(row).toMatchObject({ event: "step_completed", step_id: "SELL", step_index: 0 });
  });

  it("includes duration_ms + steps_skipped on completed", () => {
    const row = buildAnalyticsEvent({
      ...base,
      event: "completed",
      durationMs: 42000,
      stepsSkipped: 1,
      isRestart: false,
    });
    expect(row).toMatchObject({
      event: "completed",
      duration_ms: 42000,
      steps_skipped: 1,
      is_restart: false,
    });
  });

  it("rejects an unknown event at runtime", () => {
    // @ts-expect-error invalid event
    expect(() => buildAnalyticsEvent({ ...base, event: "bogus" })).toThrow();
  });
});

describe("dispatchWizardEvent", () => {
  beforeEach(() => {
    insert.mockReset();
    insert.mockResolvedValue({ error: null });
  });

  it("inserts the built row into wizard_analytics", async () => {
    await dispatchWizardEvent({ ...base, event: "started" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({ event: "started", platform: "web" });
  });

  it("never throws on insert error (fire-and-forget)", async () => {
    insert.mockResolvedValueOnce({ error: new Error("boom") });
    await expect(
      dispatchWizardEvent({ ...base, event: "shown" }),
    ).resolves.toBeUndefined();
  });
});
