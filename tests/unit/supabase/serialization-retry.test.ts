import { describe, expect, it } from "vitest";

import {
  MEANINGFUL_PROJECTION_PENDING_MESSAGE,
  SerializationRetryExhaustedError,
  isSerializationFailure,
  withSerializationRetry,
} from "@/lib/supabase/serialization-retry";

function projectionPendingError(): Error {
  return new Error(
    `email deferral disposition failed: ${MEANINGFUL_PROJECTION_PENDING_MESSAGE}`
  );
}

describe("isSerializationFailure", () => {
  it("recognizes a PostgREST error carrying SQLSTATE 40001", () => {
    expect(
      isSerializationFailure({
        code: "40001",
        message: "email_project_identity_busy",
        details: null,
        hint: null,
      })
    ).toBe(true);
  });

  it("recognizes a ProjectConversionError-shaped rpcCode 40001", () => {
    const error = Object.assign(new Error("conversion conflict"), {
      rpcCode: "40001",
    });
    expect(isSerializationFailure(error)).toBe(true);
  });

  it("recognizes the projection-pending sentinel after Error re-wrapping", () => {
    const wrapped = new Error(
      `[sync-engine] accept-to-project conversion failed before cursor advancement: ${projectionPendingError().message}`
    );
    expect(isSerializationFailure(wrapped)).toBe(true);
  });

  it("walks the cause chain", () => {
    const root = { code: "40001", message: "serialization_failure" };
    const middle = Object.assign(new Error("rpc failed"), { cause: root });
    const outer = Object.assign(new Error("worker step failed"), {
      cause: middle,
    });
    expect(isSerializationFailure(outer)).toBe(true);
  });

  it("rejects ordinary errors, other SQLSTATEs, and nullish values", () => {
    expect(isSerializationFailure(new Error("row not found"))).toBe(false);
    expect(isSerializationFailure({ code: "23505", message: "dup" })).toBe(
      false
    );
    expect(isSerializationFailure(null)).toBe(false);
    expect(isSerializationFailure(undefined)).toBe(false);
    expect(isSerializationFailure(42)).toBe(false);
  });
});

describe("withSerializationRetry", () => {
  it("returns immediately on success without sleeping", async () => {
    const delays: number[] = [];
    const result = await withSerializationRetry(async () => "ok", {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(result).toBe("ok");
    expect(delays).toEqual([]);
  });

  it("rethrows non-serialization errors without any retry", async () => {
    const delays: number[] = [];
    let calls = 0;
    await expect(
      withSerializationRetry(
        async () => {
          calls += 1;
          throw new Error("access_denied");
        },
        {
          sleep: async (ms) => {
            delays.push(ms);
          },
        }
      )
    ).rejects.toThrow("access_denied");
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it("retries serialization failures with doubling, jittered, floored delays", async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await withSerializationRetry(
      async () => {
        calls += 1;
        if (calls < 5) throw projectionPendingError();
        return "converged";
      },
      {
        maxAttempts: 5,
        baseDelayMs: 250,
        maxDelayMs: 30_000,
        sleep: async (ms) => {
          delays.push(ms);
        },
        // random() = 1 pins every delay at its exponential ceiling.
        random: () => 1,
      }
    );
    expect(result).toBe("converged");
    expect(calls).toBe(5);
    expect(delays).toEqual([250, 500, 1000, 2000]);
  });

  it("keeps a non-zero delay floor so retries can never run hot", async () => {
    const delays: number[] = [];
    let calls = 0;
    await withSerializationRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw projectionPendingError();
        return "done";
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
        // random() = 0 exercises the floor: half of each exponential ceiling.
        random: () => 0,
      }
    );
    expect(delays).toEqual([125, 250]);
    expect(delays.every((ms) => ms > 0)).toBe(true);
  });

  it("caps each delay at maxDelayMs", async () => {
    const delays: number[] = [];
    let calls = 0;
    await withSerializationRetry(
      async () => {
        calls += 1;
        if (calls < 9) throw projectionPendingError();
        return "done";
      },
      {
        maxAttempts: 9,
        baseDelayMs: 250,
        maxDelayMs: 30_000,
        sleep: async (ms) => {
          delays.push(ms);
        },
        random: () => 1,
      }
    );
    expect(delays).toEqual([250, 500, 1000, 2000, 4000, 8000, 16_000, 30_000]);
  });

  it("throws a typed exhaustion error that stays serialization-classifiable", async () => {
    const onRetryAttempts: number[] = [];
    let calls = 0;
    const attempt = withSerializationRetry(
      async () => {
        calls += 1;
        throw projectionPendingError();
      },
      {
        maxAttempts: 5,
        label: "accept evaluation for opportunity test-opp",
        sleep: async () => {},
        random: () => 0.5,
        onRetry: ({ attempt: retryAttempt }) => {
          onRetryAttempts.push(retryAttempt);
        },
      }
    );

    const error = await attempt.catch((caught) => caught as unknown);
    expect(error).toBeInstanceOf(SerializationRetryExhaustedError);
    const exhausted = error as SerializationRetryExhaustedError;
    expect(calls).toBe(5);
    expect(onRetryAttempts).toEqual([1, 2, 3, 4]);
    expect(exhausted.attempts).toBe(5);
    expect(exhausted.message).toContain(
      "accept evaluation for opportunity test-opp"
    );
    expect(exhausted.message).toContain(MEANINGFUL_PROJECTION_PENDING_MESSAGE);
    // A parked exhaustion must still classify as serialization-shaped for
    // upstream recorders, but callers must never feed it back into a retry
    // loop — that is exactly the amplifier the cap exists to remove.
    expect(isSerializationFailure(exhausted)).toBe(true);
  });
});
