import { describe, expect, it, vi } from "vitest";

import {
  PhaseCSourceTurnUnavailableError,
  createPhaseCSourceTurnRepository,
  createSupabasePhaseCSourceTurnReadAdapter,
  isTrustedPhaseCSourceTurnRepository,
} from "../phase-c-source-turn-repository";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "00000000-0000-4000-8000-000000000002";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-000000000003";
const ACTIVITY_ID = "00000000-0000-4000-8000-000000000004";
const INTERNAL_THREAD_ID = "00000000-0000-4000-8000-000000000008";
const TURN_ID = "00000000-0000-4000-8000-000000000005";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000006";
const ACTOR_ID = "00000000-0000-4000-8000-000000000007";
const PROVIDER_THREAD_ID = "provider-thread-1";

const INPUT = {
  companyId: COMPANY_ID,
  opportunityId: OPPORTUNITY_ID,
  actorUserId: ACTOR_ID,
  assignmentVersion: 7,
  connectionId: CONNECTION_ID,
  internalThreadId: INTERNAL_THREAD_ID,
  providerThreadId: PROVIDER_THREAD_ID,
  sourceActivityId: ACTIVITY_ID,
} as const;

describe("Phase C source-turn repository", () => {
  it("captures the fixed RPC once and decodes one exact source-bound turn", async () => {
    const calls: Array<{
      readonly name: string;
      readonly args: Readonly<Record<string, unknown>>;
      readonly receiver: unknown;
    }> = [];
    const client = {
      async rpc(name: string, args: Readonly<Record<string, unknown>>) {
        calls.push({ name, args, receiver: this });
        return {
          data: [
            {
              turn_id: TURN_ID,
              conversation_id: CONVERSATION_ID,
            },
          ],
          error: null,
        };
      },
    };
    const repository = createPhaseCSourceTurnRepository(
      createSupabasePhaseCSourceTurnReadAdapter(client)
    );
    client.rpc = vi.fn(async () => ({ data: [], error: null }));

    await expect(repository.resolve(INPUT)).resolves.toEqual({
      turnId: TURN_ID,
      conversationId: CONVERSATION_ID,
    });
    expect(calls).toEqual([
      {
        name: "read_phase_c_source_turn_as_system",
        receiver: client,
        args: {
          p_company_id: COMPANY_ID,
          p_opportunity_id: OPPORTUNITY_ID,
          p_actor_user_id: ACTOR_ID,
          p_assignment_version: 7,
          p_connection_id: CONNECTION_ID,
          p_internal_thread_id: INTERNAL_THREAD_ID,
          p_provider_thread_id: PROVIDER_THREAD_ID,
          p_source_activity_id: ACTIVITY_ID,
        },
      },
    ]);
    expect(Object.isFrozen(repository)).toBe(true);
    expect(isTrustedPhaseCSourceTurnRepository(repository)).toBe(true);
    expect(isTrustedPhaseCSourceTurnRepository({ ...repository })).toBe(false);
  });

  it.each([
    { data: [], error: null },
    {
      data: [
        { turn_id: TURN_ID, conversation_id: CONVERSATION_ID },
        { turn_id: TURN_ID, conversation_id: CONVERSATION_ID },
      ],
      error: null,
    },
    {
      data: [{ turn_id: "bad", conversation_id: CONVERSATION_ID }],
      error: null,
    },
    {
      data: [
        {
          turn_id: "00000000-0000-0000-8000-000000000005",
          conversation_id: CONVERSATION_ID,
        },
      ],
      error: null,
    },
    {
      data: [
        {
          turn_id: TURN_ID,
          conversation_id: CONVERSATION_ID,
          hidden: "leak",
        },
      ],
      error: null,
    },
    { data: null, error: { message: "private relation leaked" } },
  ])(
    "fails closed on missing, ambiguous, malformed, or failed reads",
    async (response) => {
      const repository = createPhaseCSourceTurnRepository(
        createSupabasePhaseCSourceTurnReadAdapter({
          rpc: vi.fn(async () => response),
        })
      );

      await expect(repository.resolve(INPUT)).rejects.toBeInstanceOf(
        PhaseCSourceTurnUnavailableError
      );
    }
  );

  it("rejects malformed identifiers before the RPC", async () => {
    const rpc = vi.fn();
    const repository = createPhaseCSourceTurnRepository(
      createSupabasePhaseCSourceTurnReadAdapter({ rpc })
    );

    await expect(
      repository.resolve({ ...INPUT, sourceActivityId: "activity-latest" })
    ).rejects.toThrow(TypeError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects accessor-backed input before the RPC can observe different values", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ turn_id: TURN_ID, conversation_id: CONVERSATION_ID }],
      error: null,
    }));
    const repository = createPhaseCSourceTurnRepository(
      createSupabasePhaseCSourceTurnReadAdapter({ rpc })
    );
    const hostileInput = { ...INPUT } as Record<string, unknown>;
    Object.defineProperty(hostileInput, "companyId", {
      configurable: true,
      enumerable: true,
      get: () => COMPANY_ID,
    });

    await expect(repository.resolve(hostileInput as never)).rejects.toThrow(
      "PHASE_C_SOURCE_TURN_INPUT_INVALID"
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("contains proxy descriptor traps before the RPC", async () => {
    const rpc = vi.fn();
    const repository = createPhaseCSourceTurnRepository(
      createSupabasePhaseCSourceTurnReadAdapter({ rpc })
    );
    const hostileInput = new Proxy(
      { ...INPUT },
      {
        getOwnPropertyDescriptor() {
          throw new TypeError("private input details");
        },
      }
    );

    await expect(repository.resolve(hostileInput)).rejects.toMatchObject({
      name: "TypeError",
      message: "PHASE_C_SOURCE_TURN_INPUT_INVALID",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a transparent proxy input before the RPC", async () => {
    const rpc = vi.fn();
    const repository = createPhaseCSourceTurnRepository(
      createSupabasePhaseCSourceTurnReadAdapter({ rpc })
    );

    await expect(
      repository.resolve(new Proxy({ ...INPUT }, {}))
    ).rejects.toThrow("PHASE_C_SOURCE_TURN_INPUT_INVALID");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { actorUserId: "actor-latest" },
    { companyId: "00000000-0000-0000-8000-000000000001" },
    { connectionId: "00000000-0000-4000-7000-000000000002" },
    { internalThreadId: "00000000-0000-0000-8000-000000000008" },
    { sourceActivityId: "00000000-0000-0000-0000-000000000000" },
    { assignmentVersion: -1 },
    { assignmentVersion: 1.5 },
    { assignmentVersion: Number.MAX_SAFE_INTEGER + 1 },
  ])(
    "rejects a noncanonical assignment fence before the RPC",
    async (patch) => {
      const rpc = vi.fn();
      const repository = createPhaseCSourceTurnRepository(
        createSupabasePhaseCSourceTurnReadAdapter({ rpc })
      );

      await expect(repository.resolve({ ...INPUT, ...patch })).rejects.toThrow(
        TypeError
      );
      expect(rpc).not.toHaveBeenCalled();
    }
  );

  it.each([
    " provider-thread",
    "provider-thread ",
    "provider\u0000thread",
    "é".repeat(257),
  ])("rejects a noncanonical provider thread before the RPC", async (value) => {
    const rpc = vi.fn();
    const repository = createPhaseCSourceTurnRepository(
      createSupabasePhaseCSourceTurnReadAdapter({ rpc })
    );

    await expect(
      repository.resolve({ ...INPUT, providerThreadId: value })
    ).rejects.toThrow(TypeError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("contains hostile decoder objects as unavailable source proof", async () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new TypeError("private decoder details");
        },
      }
    );
    const repository = createPhaseCSourceTurnRepository(
      createSupabasePhaseCSourceTurnReadAdapter({
        rpc: vi.fn(async () => ({ data: [hostile], error: null })),
      })
    );

    await expect(repository.resolve(INPUT)).rejects.toMatchObject({
      name: "PhaseCSourceTurnUnavailableError",
      message: "The exact delivered Phase C source turn is unavailable.",
    });
  });

  it("rejects transparent proxy arrays and rows returned by the RPC", async () => {
    const validRow = {
      turn_id: TURN_ID,
      conversation_id: CONVERSATION_ID,
    };

    for (const data of [new Proxy([validRow], {}), [new Proxy(validRow, {})]]) {
      const repository = createPhaseCSourceTurnRepository(
        createSupabasePhaseCSourceTurnReadAdapter({
          rpc: vi.fn(async () => ({ data, error: null })),
        })
      );

      await expect(repository.resolve(INPUT)).rejects.toBeInstanceOf(
        PhaseCSourceTurnUnavailableError
      );
    }
  });

  it("rejects accessor-backed source rows instead of trusting values after validation", async () => {
    let turnReads = 0;
    let conversationReads = 0;
    const row = {};
    Object.defineProperties(row, {
      turn_id: {
        enumerable: true,
        get() {
          turnReads += 1;
          return turnReads === 1 ? TURN_ID : "ATTACKER-CONTROLLED";
        },
      },
      conversation_id: {
        enumerable: true,
        get() {
          conversationReads += 1;
          return conversationReads === 1
            ? CONVERSATION_ID
            : "ATTACKER-CONTROLLED";
        },
      },
    });
    const repository = createPhaseCSourceTurnRepository(
      createSupabasePhaseCSourceTurnReadAdapter({
        rpc: vi.fn(async () => ({ data: [row], error: null })),
      })
    );

    await expect(repository.resolve(INPUT)).rejects.toMatchObject({
      name: "PhaseCSourceTurnUnavailableError",
      message: "The exact delivered Phase C source turn is unavailable.",
    });
  });

  it("fails closed when the awaited RPC mutates a decoder intrinsic", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Object,
      "getOwnPropertyDescriptors"
    );
    if (!originalDescriptor || !("value" in originalDescriptor)) {
      throw new Error("Object descriptor intrinsic is unavailable");
    }
    const original =
      originalDescriptor.value as typeof Object.getOwnPropertyDescriptors;
    const rawRow = {
      turn_id: TURN_ID,
      conversation_id: CONVERSATION_ID,
    };
    const forgedRow = {
      turn_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      conversation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };
    const rawData = [rawRow];
    const repository = createPhaseCSourceTurnRepository(
      createSupabasePhaseCSourceTurnReadAdapter({
        async rpc() {
          Object.defineProperty(Object, "getOwnPropertyDescriptors", {
            ...originalDescriptor,
            value(value: object) {
              return original(value === rawData ? [forgedRow] : value);
            },
          });
          return { data: rawData, error: null };
        },
      })
    );

    let resolution: unknown;
    let caught: unknown;
    try {
      resolution = await repository.resolve(INPUT);
    } catch (error) {
      caught = error;
    } finally {
      Object.defineProperty(
        Object,
        "getOwnPropertyDescriptors",
        originalDescriptor
      );
    }

    expect(resolution).toBeUndefined();
    expect(caught).toBeInstanceOf(PhaseCSourceTurnUnavailableError);
  });

  it("rejects an accessor-backed RPC envelope without invoking it", async () => {
    let dataReads = 0;
    let errorReads = 0;
    const response = {};
    Object.defineProperties(response, {
      data: {
        enumerable: true,
        get() {
          dataReads += 1;
          return [{ turn_id: TURN_ID, conversation_id: CONVERSATION_ID }];
        },
      },
      error: {
        enumerable: true,
        get() {
          errorReads += 1;
          return null;
        },
      },
    });
    const repository = createPhaseCSourceTurnRepository(
      createSupabasePhaseCSourceTurnReadAdapter({
        async rpc() {
          return response as never;
        },
      })
    );

    await expect(repository.resolve(INPUT)).rejects.toBeInstanceOf(
      PhaseCSourceTurnUnavailableError
    );
    expect(dataReads).toBe(0);
    expect(errorReads).toBe(0);
  });

  it("accepts only the exact adapter minted by the fixed Supabase boundary", () => {
    expect(() =>
      createPhaseCSourceTurnRepository({
        read: vi.fn(),
      } as never)
    ).toThrow(TypeError);
  });
});
