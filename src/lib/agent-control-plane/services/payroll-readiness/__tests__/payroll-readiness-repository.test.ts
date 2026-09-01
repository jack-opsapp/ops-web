import { describe, expect, it, vi } from "vitest";
import { PayrollReadinessTargetDateError } from "@/lib/agent-control-plane/contracts/payroll-readiness";

import {
  createPayrollReadinessRepository,
  PayrollReadinessRepositoryUnavailableError,
  type PayrollReadinessRpcClient,
} from "../payroll-readiness-repository";
import {
  COMPANY_ID,
  PAYROLL_CLIENT_ID,
  PAYROLL_GRANT_ID,
  PAYROLL_SCOPES,
  PAYROLL_USER_ID,
  payrollReadinessActorFixture,
  payrollReadinessSourceFixture,
} from "./fixtures";

describe("payroll readiness repository", () => {
  it("makes one abortable read with the exact v14/v8 binding and bounds", async () => {
    const { actor } = await payrollReadinessActorFixture();
    const source = payrollReadinessSourceFixture();
    const signal = new AbortController().signal;
    const abortSignal = vi.fn(async () => ({ data: source, error: null }));
    const rpc = vi.fn<PayrollReadinessRpcClient["rpc"]>(() =>
      Object.assign(Promise.resolve({ data: source, error: null }), {
        abortSignal,
      })
    );

    await expect(
      createPayrollReadinessRepository({ rpc }).readSourceSnapshot({
        actorContext: actor,
        observedAt: source.observed_at,
        targetDate: source.target_date,
        signal,
      })
    ).resolves.toEqual(source);

    expect(rpc).toHaveBeenCalledWith("read_agent_payroll_readiness_as_system", {
      p_actor_user_id: PAYROLL_USER_ID,
      p_company_id: COMPANY_ID,
      p_oauth_grant_id: PAYROLL_GRANT_ID,
      p_oauth_client_id: PAYROLL_CLIENT_ID,
      p_grant_revision: "b".repeat(32),
      p_granted_scope_ceiling: PAYROLL_SCOPES,
      p_permission_snapshot_revision: `sha256:${"a".repeat(64)}`,
      p_capability_manifest_revision: "2026-09-01.capability-manifest.v14",
      p_exposure_revision: "2026-09-01.mcp-exposure.v8",
      p_capability_id: "check_payroll_readiness",
      p_capability_revision: "check_payroll_readiness:2026-09-01.v1",
      p_observed_at: source.observed_at,
      p_target_date: source.target_date,
      p_recurring_obligation_limit: 40,
      p_reimbursement_batch_limit: 50,
      p_receivable_limit: 100,
      p_payer_history_limit: 500,
    });
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });

  it("binds the same instant across JavaScript millisecond and PostgreSQL microsecond formatting", async () => {
    const { actor } = await payrollReadinessActorFixture();
    const source = payrollReadinessSourceFixture();
    const postgresSource = {
      ...source,
      observed_at: "2026-09-01T16:00:00.000000Z",
    };
    await expect(
      createPayrollReadinessRepository({
        rpc: () => Promise.resolve({ data: postgresSource, error: null }),
      }).readSourceSnapshot({
        actorContext: actor,
        observedAt: "2026-09-01T16:00:00.000Z",
        targetDate: source.target_date,
      })
    ).resolves.toEqual(postgresSource);
  });

  it("rejects wrong manifest actors, storage errors, clock drift, target drift, and malformed data", async () => {
    const { actor } = await payrollReadinessActorFixture();
    const source = payrollReadinessSourceFixture();
    const rpc = vi.fn<PayrollReadinessRpcClient["rpc"]>(() =>
      Promise.resolve({ data: source, error: null })
    );
    await expect(
      createPayrollReadinessRepository({ rpc }).readSourceSnapshot({
        actorContext: { ...actor, capabilityManifestRevision: "wrong" },
        observedAt: source.observed_at,
        targetDate: source.target_date,
      })
    ).rejects.toThrow("Payroll readiness requires a v14 MCP actor");
    expect(rpc).not.toHaveBeenCalled();

    const failing = createPayrollReadinessRepository({
      rpc: () => Promise.resolve({ data: null, error: { code: "XX000" } }),
    });
    await expect(
      failing.readSourceSnapshot({
        actorContext: actor,
        observedAt: source.observed_at,
        targetDate: source.target_date,
      })
    ).rejects.toBeInstanceOf(PayrollReadinessRepositoryUnavailableError);

    const invalidTarget = createPayrollReadinessRepository({
      rpc: () =>
        Promise.resolve({
          data: null,
          error: {
            code: "22023",
            message: "AGENT_PAYROLL_READINESS_TARGET_DATE_INVALID",
          },
        }),
    });
    await expect(
      invalidTarget.readSourceSnapshot({
        actorContext: actor,
        observedAt: source.observed_at,
        targetDate: source.target_date,
      })
    ).rejects.toBeInstanceOf(PayrollReadinessTargetDateError);

    for (const data of [
      { ...source, observed_at: "2026-09-01T16:00:01.000Z" },
      { ...source, target_date: "2026-09-16" },
      {
        ...source,
        context: {
          ...source.context,
          company_id: "99999999-9999-4999-8999-999999999999",
        },
      },
      { ...source, business_date: "2026-08-31" },
      { ...source, context: { ...source.context, timezone: "Invalid/Zone" } },
    ]) {
      await expect(
        createPayrollReadinessRepository({
          rpc: () => Promise.resolve({ data, error: null }),
        }).readSourceSnapshot({
          actorContext: actor,
          observedAt: source.observed_at,
          targetDate: source.target_date,
        })
      ).rejects.toBeInstanceOf(PayrollReadinessRepositoryUnavailableError);
    }
  });
});
