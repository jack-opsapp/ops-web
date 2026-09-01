import { describe, expect, it, vi } from "vitest";

import type { CustomerIdentityDeps } from "@/lib/customer-identity/config";
import {
  CustomerAccessError,
  CustomerIdentityInputError,
  CustomerIdentityStoreError,
} from "@/lib/customer-identity/errors";
import {
  requireMembership,
  resolveMembership,
} from "@/lib/customer-identity/membership";

const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const SUB_CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const MEMBERSHIP_ID = "66666666-6666-4666-8666-666666666666";
const SESSION = { identityId: IDENTITY_ID, sessionId: SESSION_ID };

function makeDeps(row: unknown, error: unknown = null) {
  const rpc = vi.fn(async () => ({ data: row, error }));
  const deps: CustomerIdentityDeps = {
    rpc: { rpc },
    auth: {
      auth: {
        signInWithOtp: vi.fn(),
        verifyOtp: vi.fn(),
        admin: { updateUserById: vi.fn() },
      },
    },
    keyRing: { activeKid: 1, keys: new Map([[1, Buffer.alloc(32, 9)]]) },
  };
  return { deps, rpc };
}

function row(state: string, outcome: string) {
  return [
    {
      membership_id: MEMBERSHIP_ID,
      client_id: CLIENT_ID,
      sub_client_id: SUB_CLIENT_ID,
      state,
      outcome,
    },
  ];
}

describe("resolveMembership", () => {
  it("calls the resolution RPC for exactly this identity and company", async () => {
    const { deps, rpc } = makeDeps(row("active_full", "created"));
    await resolveMembership(deps, IDENTITY_ID, COMPANY_ID);
    expect(rpc).toHaveBeenCalledWith("resolve_customer_membership_as_system", {
      p_identity_id: IDENTITY_ID,
      p_company_id: COMPANY_ID,
    });
  });

  it.each([
    ["existing", "active_full"],
    ["matched_forward_only", "active_forward_only"],
    ["matched_full", "active_full"],
    ["created", "active_full"],
    ["created_possible_duplicate", "active_full"],
  ] as const)("maps the %s outcome with its state", async (outcome, state) => {
    const { deps } = makeDeps(row(state, outcome));
    const membership = await resolveMembership(deps, IDENTITY_ID, COMPANY_ID);
    expect(membership).toEqual({ membershipId: MEMBERSHIP_ID, state, outcome });
  });

  it("never exposes the company-owned client ids to its caller", async () => {
    const { deps } = makeDeps(row("active_full", "existing"));
    const membership = await resolveMembership(deps, IDENTITY_ID, COMPANY_ID);
    const serialized = JSON.stringify(membership);
    expect(serialized).not.toContain(CLIENT_ID);
    expect(serialized).not.toContain(SUB_CLIENT_ID);
    expect(serialized).not.toContain(COMPANY_ID);
    expect(Object.keys(membership ?? {}).sort()).toEqual(["membershipId", "outcome", "state"]);
  });

  it("returns null when the database resolves nothing", async () => {
    const { deps } = makeDeps([]);
    expect(await resolveMembership(deps, IDENTITY_ID, COMPANY_ID)).toBeNull();
  });

  it("refuses malformed ids before calling the database", async () => {
    const { deps, rpc } = makeDeps(row("active_full", "existing"));
    await expect(resolveMembership(deps, "nope", COMPANY_ID)).rejects.toBeInstanceOf(
      CustomerIdentityInputError
    );
    await expect(resolveMembership(deps, IDENTITY_ID, "nope")).rejects.toBeInstanceOf(
      CustomerIdentityInputError
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("propagates store failures", async () => {
    const { deps } = makeDeps(null, { message: "down" });
    await expect(resolveMembership(deps, IDENTITY_ID, COMPANY_ID)).rejects.toBeInstanceOf(
      CustomerIdentityStoreError
    );
  });
});

describe("requireMembership", () => {
  async function denial(
    deps: CustomerIdentityDeps,
    options: { needFullHistory: boolean }
  ): Promise<string> {
    try {
      await requireMembership(deps, SESSION, COMPANY_ID, options);
    } catch (error) {
      expect(error).toBeInstanceOf(CustomerAccessError);
      return (error as CustomerAccessError).denial;
    }
    throw new Error("expected a denial");
  }

  it("grants a full membership whether or not history is needed", async () => {
    const { deps } = makeDeps(row("active_full", "existing"));
    for (const needFullHistory of [true, false]) {
      const membership = await requireMembership(deps, SESSION, COMPANY_ID, { needFullHistory });
      expect(membership.state).toBe("active_full");
    }
  });

  it("grants a forward-only membership for forward-only surfaces and denies FORWARD_ONLY when history is needed", async () => {
    const { deps } = makeDeps(row("active_forward_only", "matched_forward_only"));
    const membership = await requireMembership(deps, SESSION, COMPANY_ID, { needFullHistory: false });
    expect(membership.state).toBe("active_forward_only");
    expect(await denial(deps, { needFullHistory: true })).toBe("FORWARD_ONLY");
  });

  it("denies REVOKED for a revoked membership regardless of need", async () => {
    const { deps } = makeDeps(row("revoked", "existing"));
    expect(await denial(deps, { needFullHistory: false })).toBe("REVOKED");
    expect(await denial(deps, { needFullHistory: true })).toBe("REVOKED");
  });

  it("denies NOT_FOUND for a merged-away membership and when nothing resolves", async () => {
    expect(await denial(makeDeps(row("merged", "existing")).deps, { needFullHistory: false })).toBe(
      "NOT_FOUND"
    );
    expect(await denial(makeDeps([]).deps, { needFullHistory: false })).toBe("NOT_FOUND");
  });

  it("re-resolves on every call so a revocation binds on the next request (I3)", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: row("active_full", "existing"), error: null })
      .mockResolvedValueOnce({ data: row("revoked", "existing"), error: null });
    const deps: CustomerIdentityDeps = {
      rpc: { rpc },
      auth: {
        auth: { signInWithOtp: vi.fn(), verifyOtp: vi.fn(), admin: { updateUserById: vi.fn() } },
      },
      keyRing: { activeKid: 1, keys: new Map([[1, Buffer.alloc(32, 9)]]) },
    };
    await requireMembership(deps, SESSION, COMPANY_ID, { needFullHistory: false });
    expect(await denial(deps, { needFullHistory: false })).toBe("REVOKED");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("denies with a message that carries no identifiers", async () => {
    const { deps } = makeDeps([]);
    try {
      await requireMembership(deps, SESSION, COMPANY_ID, { needFullHistory: false });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(IDENTITY_ID);
      expect(message).not.toContain(COMPANY_ID);
      expect(message).not.toContain(SESSION_ID);
    }
  });
});
