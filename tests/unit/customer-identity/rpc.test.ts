import { describe, expect, it, vi } from "vitest";

import {
  appendIdentityEvent,
  beginOtpChallenge,
  confirmMembership,
  ensurePairwiseRef,
  listMembershipsForClient,
  mintSession,
  recordOtpAttempt,
  resolveMembershipRow,
  resolveSession,
  revokeAllSessions,
  revokeMembership,
  revokeSession,
  upsertIdentity,
  type CustomerIdentityRpcClient,
  type IdentityEventMetadata,
} from "@/lib/customer-identity/rpc";
import {
  CustomerContactConflictError,
  CustomerIdentityStoreError,
} from "@/lib/customer-identity/errors";

const CHALLENGE_ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const COMPANY_ID = "ddee107c-33cd-483e-8278-0f8d8a180181";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const SUB_CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const MEMBERSHIP_ID = "66666666-6666-4666-8666-666666666666";
const INTEGRATION_ID = "77777777-7777-4777-8777-777777777777";
const STAFF_USER_ID = "8e811f98-9f2b-4f64-b409-ed56074b7dc8";
const SESSION_HASH = "a".repeat(64);
const EMAIL_DIGEST = `2:${"b".repeat(64)}`;
const FINGERPRINT = "c".repeat(64);
const AUTH_SUBJECT = "88888888-8888-4888-8888-888888888888";

function clientReturning(
  data: unknown,
  error: unknown = null
): CustomerIdentityRpcClient & { rpc: ReturnType<typeof vi.fn> } {
  return { rpc: vi.fn(async () => ({ data, error })) };
}

function clientThrowing(): CustomerIdentityRpcClient {
  return {
    rpc: async () => {
      throw new Error("network");
    },
  };
}

async function expectStoreError(
  run: () => Promise<unknown>,
  operation: string
): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CustomerIdentityStoreError);
  expect((caught as CustomerIdentityStoreError).operation).toBe(operation);
}

describe("beginOtpChallenge", () => {
  it("calls begin_customer_otp_challenge_as_system with the digest and fingerprint", async () => {
    const client = clientReturning([
      { challenge_id: CHALLENGE_ID, allowed: true, retry_after_seconds: 60 },
    ]);
    const row = await beginOtpChallenge(client, {
      emailDigest: EMAIL_DIGEST,
      networkFingerprint: FINGERPRINT,
    });
    expect(row).toEqual({
      challenge_id: CHALLENGE_ID,
      allowed: true,
      retry_after_seconds: 60,
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "begin_customer_otp_challenge_as_system",
      { p_email_digest: EMAIL_DIGEST, p_network_fingerprint: FINGERPRINT }
    );
  });

  it("accepts a refused challenge with no id and a positive retry", async () => {
    const client = clientReturning([
      { challenge_id: null, allowed: false, retry_after_seconds: 47 },
    ]);
    const row = await beginOtpChallenge(client, {
      emailDigest: EMAIL_DIGEST,
      networkFingerprint: FINGERPRINT,
    });
    expect(row.allowed).toBe(false);
    expect(row.challenge_id).toBeNull();
    expect(row.retry_after_seconds).toBe(47);
  });

  it.each([
    ["no rows", []],
    ["two rows", [{}, {}]],
    ["negative retry", [{ challenge_id: CHALLENGE_ID, allowed: true, retry_after_seconds: -1 }]],
    ["non-integer retry", [{ challenge_id: CHALLENGE_ID, allowed: true, retry_after_seconds: 1.5 }]],
    ["malformed id", [{ challenge_id: "nope", allowed: true, retry_after_seconds: 60 }]],
    ["allowed but no id", [{ challenge_id: null, allowed: true, retry_after_seconds: 60 }]],
  ])("throws a store error for %s", async (_label, data) => {
    await expectStoreError(
      () =>
        beginOtpChallenge(clientReturning(data), {
          emailDigest: EMAIL_DIGEST,
          networkFingerprint: FINGERPRINT,
        }),
      "begin_customer_otp_challenge"
    );
  });

  it("throws a store error when the RPC errors or throws", async () => {
    await expectStoreError(
      () =>
        beginOtpChallenge(clientReturning(null, { message: "boom" }), {
          emailDigest: EMAIL_DIGEST,
          networkFingerprint: FINGERPRINT,
        }),
      "begin_customer_otp_challenge"
    );
    await expectStoreError(
      () =>
        beginOtpChallenge(clientThrowing(), {
          emailDigest: EMAIL_DIGEST,
          networkFingerprint: FINGERPRINT,
        }),
      "begin_customer_otp_challenge"
    );
  });
});

describe("recordOtpAttempt", () => {
  it("returns the attempt count and exhaustion flag", async () => {
    const client = clientReturning([{ attempts: 3, exhausted: false }]);
    const row = await recordOtpAttempt(client, {
      challengeId: CHALLENGE_ID,
      success: false,
    });
    expect(row).toEqual({ attempts: 3, exhausted: false });
    expect(client.rpc).toHaveBeenCalledWith(
      "record_customer_otp_attempt_as_system",
      { p_challenge_id: CHALLENGE_ID, p_success: false }
    );
  });

  it("returns null for an unknown challenge (no row) so the caller refuses uniformly", async () => {
    expect(
      await recordOtpAttempt(clientReturning([]), {
        challengeId: CHALLENGE_ID,
        success: false,
      })
    ).toBeNull();
    expect(
      await recordOtpAttempt(clientReturning(null), {
        challengeId: CHALLENGE_ID,
        success: false,
      })
    ).toBeNull();
  });

  it("throws a store error for a malformed row", async () => {
    await expectStoreError(
      () =>
        recordOtpAttempt(clientReturning([{ attempts: -1, exhausted: false }]), {
          challengeId: CHALLENGE_ID,
          success: false,
        }),
      "record_customer_otp_attempt"
    );
  });
});

describe("upsertIdentity", () => {
  it("returns the identity id and created flag", async () => {
    const client = clientReturning([
      { identity_id: IDENTITY_ID, created: true },
    ]);
    const row = await upsertIdentity(client, {
      authSubject: AUTH_SUBJECT,
      email: "jane@example.com",
    });
    expect(row).toEqual({ identity_id: IDENTITY_ID, created: true });
    expect(client.rpc).toHaveBeenCalledWith(
      "upsert_customer_identity_as_system",
      { p_auth_subject: AUTH_SUBJECT, p_email: "jane@example.com" }
    );
  });

  it("maps the customer_contact_conflict unique violation to the typed conflict error", async () => {
    const client = clientReturning(null, {
      code: "23505",
      message: "customer_contact_conflict",
      details: null,
      hint: null,
    });
    await expect(
      upsertIdentity(client, {
        authSubject: AUTH_SUBJECT,
        email: "jane@example.com",
      })
    ).rejects.toBeInstanceOf(CustomerContactConflictError);
  });

  it("treats any other unique violation as a store failure, not a conflict", async () => {
    const client = clientReturning(null, {
      code: "23505",
      message: "duplicate key value violates unique constraint",
    });
    await expectStoreError(
      () =>
        upsertIdentity(client, {
          authSubject: AUTH_SUBJECT,
          email: "jane@example.com",
        }),
      "upsert_customer_identity"
    );
  });
});

describe("sessions", () => {
  it("mints a session and returns the scalar session id", async () => {
    const client = clientReturning(SESSION_ID);
    expect(
      await mintSession(client, {
        identityId: IDENTITY_ID,
        sessionHash: SESSION_HASH,
        networkFingerprint: FINGERPRINT,
      })
    ).toBe(SESSION_ID);
    expect(client.rpc).toHaveBeenCalledWith(
      "mint_customer_session_as_system",
      {
        p_identity_id: IDENTITY_ID,
        p_session_hash: SESSION_HASH,
        p_network_fingerprint: FINGERPRINT,
      }
    );
  });

  it("refuses a session hash that is not a SHA-256 hex digest before calling the database", async () => {
    const client = clientReturning(SESSION_ID);
    await expectStoreError(
      () =>
        mintSession(client, {
          identityId: IDENTITY_ID,
          sessionHash: "ops_cs_not_a_digest",
          networkFingerprint: FINGERPRINT,
        }),
      "mint_customer_session"
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid minted session id", async () => {
    await expectStoreError(
      () =>
        mintSession(clientReturning("not-a-uuid"), {
          identityId: IDENTITY_ID,
          sessionHash: SESSION_HASH,
          networkFingerprint: FINGERPRINT,
        }),
      "mint_customer_session"
    );
  });

  it("resolves an ok session with both ids", async () => {
    const client = clientReturning([
      { identity_id: IDENTITY_ID, session_id: SESSION_ID, status: "ok" },
    ]);
    expect(await resolveSession(client, SESSION_HASH)).toEqual({
      identity_id: IDENTITY_ID,
      session_id: SESSION_ID,
      status: "ok",
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "resolve_customer_session_as_system",
      { p_session_hash: SESSION_HASH }
    );
  });

  it.each(["expired", "revoked", "unknown"] as const)(
    "resolves a %s session with null ids",
    async (status) => {
      const row = await resolveSession(
        clientReturning([{ identity_id: null, session_id: null, status }]),
        SESSION_HASH
      );
      expect(row.status).toBe(status);
      expect(row.identity_id).toBeNull();
    }
  );

  it("treats an ok row without ids as a store failure", async () => {
    await expectStoreError(
      () =>
        resolveSession(
          clientReturning([{ identity_id: null, session_id: null, status: "ok" }]),
          SESSION_HASH
        ),
      "resolve_customer_session"
    );
  });

  it("treats an unknown status as a store failure", async () => {
    await expectStoreError(
      () =>
        resolveSession(
          clientReturning([
            { identity_id: IDENTITY_ID, session_id: SESSION_ID, status: "fine" },
          ]),
          SESSION_HASH
        ),
      "resolve_customer_session"
    );
  });

  it("revokes one session by hash and reports whether anything changed", async () => {
    const client = clientReturning(true);
    expect(
      await revokeSession(client, { sessionHash: SESSION_HASH, reason: "user_signout" })
    ).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(
      "revoke_customer_session_as_system",
      { p_session_hash: SESSION_HASH, p_reason: "user_signout" }
    );
    expect(
      await revokeSession(clientReturning(false), {
        sessionHash: SESSION_HASH,
        reason: "user_signout",
      })
    ).toBe(false);
  });

  it("revokes every session for an identity and returns the count", async () => {
    const client = clientReturning(3);
    expect(
      await revokeAllSessions(client, {
        identityId: IDENTITY_ID,
        reason: "user_signout_everywhere",
      })
    ).toBe(3);
    expect(client.rpc).toHaveBeenCalledWith(
      "revoke_all_customer_sessions_as_system",
      { p_identity_id: IDENTITY_ID, p_reason: "user_signout_everywhere" }
    );
    await expectStoreError(
      () =>
        revokeAllSessions(clientReturning(-1), {
          identityId: IDENTITY_ID,
          reason: "user_signout_everywhere",
        }),
      "revoke_all_customer_sessions"
    );
  });
});

describe("memberships", () => {
  const ROW = {
    membership_id: MEMBERSHIP_ID,
    client_id: CLIENT_ID,
    sub_client_id: SUB_CLIENT_ID,
    state: "active_forward_only",
    outcome: "matched_forward_only",
  };

  it("resolves a membership row with every contract field", async () => {
    const client = clientReturning([ROW]);
    expect(
      await resolveMembershipRow(client, {
        identityId: IDENTITY_ID,
        companyId: COMPANY_ID,
      })
    ).toEqual(ROW);
    expect(client.rpc).toHaveBeenCalledWith(
      "resolve_customer_membership_as_system",
      { p_identity_id: IDENTITY_ID, p_company_id: COMPANY_ID }
    );
  });

  it("returns null when the database resolves nothing", async () => {
    expect(
      await resolveMembershipRow(clientReturning([]), {
        identityId: IDENTITY_ID,
        companyId: COMPANY_ID,
      })
    ).toBeNull();
  });

  it.each([
    ["unknown state", { ...ROW, state: "pending" }],
    ["unknown outcome", { ...ROW, outcome: "maybe" }],
    ["missing client", { ...ROW, client_id: null }],
  ])("throws a store error for %s", async (_label, row) => {
    await expectStoreError(
      () =>
        resolveMembershipRow(clientReturning([row]), {
          identityId: IDENTITY_ID,
          companyId: COMPANY_ID,
        }),
      "resolve_customer_membership"
    );
  });

  it("confirms a membership as staff and returns the resulting state", async () => {
    const client = clientReturning("active_full");
    expect(
      await confirmMembership(client, {
        membershipId: MEMBERSHIP_ID,
        staffUserId: STAFF_USER_ID,
      })
    ).toBe("active_full");
    expect(client.rpc).toHaveBeenCalledWith(
      "confirm_customer_membership_as_system",
      { p_membership_id: MEMBERSHIP_ID, p_staff_user_id: STAFF_USER_ID }
    );
  });

  it("revokes a membership as staff", async () => {
    const client = clientReturning(true);
    expect(
      await revokeMembership(client, {
        membershipId: MEMBERSHIP_ID,
        staffUserId: STAFF_USER_ID,
        reason: "staff_revoked",
      })
    ).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(
      "revoke_customer_membership_as_system",
      {
        p_membership_id: MEMBERSHIP_ID,
        p_staff_user_id: STAFF_USER_ID,
        p_reason: "staff_revoked",
      }
    );
  });

  it("lists memberships for a client with masked email only", async () => {
    const client = clientReturning([
      {
        membership_id: MEMBERSHIP_ID,
        state: "active_full",
        evidence_kind: "staff_confirmed",
        contact_email_masked: "j***@example.com",
        last_seen_at: "2026-09-01T12:00:00+00:00",
      },
    ]);
    const rows = await listMembershipsForClient(client, {
      companyId: COMPANY_ID,
      clientId: CLIENT_ID,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].contact_email_masked).toBe("j***@example.com");
    expect(Object.isFrozen(rows)).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(
      "list_customer_memberships_for_client_as_system",
      { p_company_id: COMPANY_ID, p_client_id: CLIENT_ID }
    );
    expect(
      await listMembershipsForClient(clientReturning(null), {
        companyId: COMPANY_ID,
        clientId: CLIENT_ID,
      })
    ).toEqual([]);
  });

  it("refuses a listing row that carries an unmasked email", async () => {
    await expectStoreError(
      () =>
        listMembershipsForClient(
          clientReturning([
            {
              membership_id: MEMBERSHIP_ID,
              state: "active_full",
              evidence_kind: "staff_confirmed",
              contact_email_masked: "jane@example.com",
              last_seen_at: null,
            },
          ]),
          { companyId: COMPANY_ID, clientId: CLIENT_ID }
        ),
      "list_customer_memberships_for_client"
    );
  });
});

describe("ensurePairwiseRef", () => {
  it("returns the opaque public ref", async () => {
    const client = clientReturning("cref_abc123");
    expect(
      await ensurePairwiseRef(client, {
        identityId: IDENTITY_ID,
        integrationId: INTEGRATION_ID,
      })
    ).toBe("cref_abc123");
    expect(client.rpc).toHaveBeenCalledWith(
      "ensure_customer_pairwise_ref_as_system",
      { p_identity_id: IDENTITY_ID, p_integration_id: INTEGRATION_ID }
    );
  });

  it("refuses a ref that looks like a raw uuid", async () => {
    await expectStoreError(
      () =>
        ensurePairwiseRef(clientReturning(IDENTITY_ID), {
          identityId: IDENTITY_ID,
          integrationId: INTEGRATION_ID,
        }),
      "ensure_customer_pairwise_ref"
    );
  });
});

describe("appendIdentityEvent", () => {
  it("writes through the single-writer RPC with nullable scope columns", async () => {
    const client = clientReturning(null);
    await appendIdentityEvent(client, {
      eventType: "session_issued",
      identityId: IDENTITY_ID,
      companyId: null,
      sessionId: SESSION_ID,
      networkFingerprint: FINGERPRINT,
      metadata: { created: true },
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "append_customer_identity_event_as_system",
      {
        p_event_type: "session_issued",
        p_identity_id: IDENTITY_ID,
        p_company_id: null,
        p_session_id: SESSION_ID,
        p_network_fingerprint: FINGERPRINT,
        p_metadata: { created: true },
      }
    );
  });

  it("refuses metadata that could carry a secret, before the database sees it", async () => {
    const client = clientReturning(null);
    const unsafe: IdentityEventMetadata[] = [
      { code: "123456" },
      { token: "x" },
      { credential: "ops_cs_x" },
      { session_hash: "a" },
      { email: "jane@example.com" },
      { nested: { access_token: "x" } },
      { note: "ops_cs_dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" },
      { note: "jane@example.com" },
    ];
    for (const metadata of unsafe) {
      await expectStoreError(
        () =>
          appendIdentityEvent(client, {
            eventType: "otp_started",
            identityId: null,
            companyId: null,
            sessionId: null,
            networkFingerprint: FINGERPRINT,
            metadata,
          }),
        "append_customer_identity_event"
      );
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
