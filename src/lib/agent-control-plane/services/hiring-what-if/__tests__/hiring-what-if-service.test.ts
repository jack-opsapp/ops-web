import { describe, expect, it, vi } from "vitest";

import { ActorAccessError } from "@/lib/agent-control-plane/actor/errors";
import {
  createHiringWhatIfRepository,
  type HiringWhatIfRpcClient,
} from "../hiring-what-if-repository";
import {
  createHiringWhatIfService,
  HiringWhatIfReadError,
} from "../hiring-what-if-service";
import {
  HIRING_PERMISSIONS,
  hiringActorFixture,
  hiringAuthority,
  hiringSourceFixture,
} from "./fixtures";

const HIRING_OBSERVED_AT = new Date("2026-09-01T04:00:00.000Z");

function serviceFixture() {
  const source = hiringSourceFixture();
  const rpc = vi.fn<HiringWhatIfRpcClient["rpc"]>(() =>
    Promise.resolve({ data: source, error: null })
  );
  return {
    source,
    rpc,
    repository: createHiringWhatIfRepository({ rpc }),
  };
}

describe("hiring what-if service", () => {
  it("reauthorizes immediately before one read and returns the validated server-owned answer", async () => {
    const { actor, authorityClient } = await hiringActorFixture();
    const { repository, rpc } = serviceFixture();
    const signal = new AbortController().signal;
    const service = createHiringWhatIfService({
      repository,
      authorityRepository: authorityClient.repository,
      now: () => HIRING_OBSERVED_AT,
    });
    const lookupsBefore = authorityClient.actorLookups.length;

    const result = await service.analyzeHiringBreakEven(
      actor,
      { role: "Installer", hourly_cost: 42.5 },
      { signal }
    );

    expect(result.state).toBe("ready");
    expect(result.role_query).toBe("Installer");
    expect(result.input_semantics).toContain("All-in employer cost");
    expect(authorityClient.actorLookups).toHaveLength(lookupsBefore + 1);
    expect(authorityClient.actorSignals.at(-1)).toBe(signal);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("executes the inherited tool under a real v15 actor and v9 binding", async () => {
    const { actor, authorityClient } = await hiringActorFixture(
      HIRING_PERMISSIONS,
      "2026-09-01.capability-manifest.v15"
    );
    const { repository, rpc } = serviceFixture();
    const service = createHiringWhatIfService({
      repository,
      authorityRepository: authorityClient.repository,
      now: () => HIRING_OBSERVED_AT,
    });

    await expect(
      service.analyzeHiringBreakEven(actor, {
        role: "Installer",
        hourly_cost: 42.5,
      })
    ).resolves.toMatchObject({ state: "ready" });
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_capability_manifest_revision: "2026-09-01.capability-manifest.v15",
      p_exposure_revision: "2026-09-01.mcp-exposure.v9",
    });
  });

  it("fails before source access when current permission is gone", async () => {
    const { actor, authorityClient } = await hiringActorFixture();
    const { repository, rpc } = serviceFixture();
    authorityClient.mcpResult = hiringAuthority(
      HIRING_PERMISSIONS.filter((permission) => permission !== "reports.view")
    );
    const service = createHiringWhatIfService({
      repository,
      authorityRepository: authorityClient.repository,
      now: () => HIRING_OBSERVED_AT,
    });

    await expect(
      service.analyzeHiringBreakEven(actor, {
        role: "Installer",
        hourly_cost: 42.5,
      })
    ).rejects.toBeInstanceOf(ActorAccessError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps invalid caller input and source failure to safe contract errors", async () => {
    const { actor, authorityClient } = await hiringActorFixture();
    const { repository } = serviceFixture();
    const service = createHiringWhatIfService({
      repository,
      authorityRepository: authorityClient.repository,
    });
    await expect(
      service.analyzeHiringBreakEven(actor, {
        role: "Installer",
        hourly_cost: 42.55555,
      })
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });

    const inexactForCurrency = createHiringWhatIfService({
      repository,
      authorityRepository: authorityClient.repository,
      now: () => HIRING_OBSERVED_AT,
    });
    await expect(
      inexactForCurrency.analyzeHiringBreakEven(actor, {
        role: "Installer",
        hourly_cost: 42.555,
      })
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });

    const unavailable = createHiringWhatIfService({
      repository: createHiringWhatIfRepository({
        rpc: () => Promise.resolve({ data: null, error: { code: "XX000" } }),
      }),
      authorityRepository: authorityClient.repository,
      now: () => HIRING_OBSERVED_AT,
    });
    await expect(
      unavailable.analyzeHiringBreakEven(actor, {
        role: "Installer",
        hourly_cost: 42.5,
      })
    ).rejects.toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      retryable: true,
    });

    const malformed = createHiringWhatIfService({
      repository: createHiringWhatIfRepository({
        rpc: () => Promise.resolve({ data: { malformed: true }, error: null }),
      }),
      authorityRepository: authorityClient.repository,
      now: () => HIRING_OBSERVED_AT,
    });
    await expect(
      malformed.analyzeHiringBreakEven(actor, {
        role: "Installer",
        hourly_cost: 42.5,
      })
    ).rejects.toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
      retryable: true,
    });
  });

  it("rejects untrusted dependencies and result-budget overflow", async () => {
    const { actor, authorityClient } = await hiringActorFixture();
    const { repository } = serviceFixture();
    expect(() =>
      createHiringWhatIfService({
        repository: {} as never,
        authorityRepository: authorityClient.repository,
      })
    ).toThrow("A trusted hiring analysis repository is required");

    const service = createHiringWhatIfService({
      repository,
      authorityRepository: authorityClient.repository,
      now: () => HIRING_OBSERVED_AT,
      maxOutputCharacters: 10,
    });
    await expect(
      service.analyzeHiringBreakEven(actor, {
        role: "Installer",
        hourly_cost: 42.5,
      })
    ).rejects.toBeInstanceOf(HiringWhatIfReadError);
    await expect(
      service.analyzeHiringBreakEven(actor, {
        role: "Installer",
        hourly_cost: 42.5,
      })
    ).rejects.toMatchObject({ code: "RESULT_TOO_LARGE" });
  });
});
