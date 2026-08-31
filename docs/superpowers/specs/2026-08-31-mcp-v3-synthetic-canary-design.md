# MCP v3 Synthetic Canary Gate

**Status:** Approved in chat on 2026-08-31. Design contract for implementation planning.
**Parent:** `docs/plans/2026-08-31-ops-mcp-day-closeout-production-readiness.md`
**Production baseline:** read-only exposure `2026-08-29.mcp-exposure.v2` remains active; inactive exposure `2026-08-30.mcp-exposure.v3` contains only `prepare_day_closeout` and its exact seven-scope ceiling.

## Problem

The production-readiness release correctly keeps dynamic registration, consent preview, consent decision, authorization-code exchange, and new token grants pinned to active v2. That prevents accidental v3 exposure, but it also makes the documented pre-activation acceptance sequence impossible: an operator cannot consent to one v3 connection until v3 is globally active, while v3 must not become globally active until one production connection passes acceptance.

The missing mechanism is a narrow canary authority lane. It must prove the real production OAuth, host, MCP, approval, receipt, refresh, revocation, and routine-handoff contracts without changing public metadata or granting v3 to any ordinary registration.

## Decision

Add an expiring, database-enforced canary binding for one exact OAuth client, OPS user, company, exposure revision, and consent-catalog revision. The active public exposure remains v2. A request may resolve inactive v3 only when every canary binding fact matches current production state. Every mismatch follows the existing opaque OAuth rejection path.

This is preferred over:

- temporarily activating v3 and reverting, which creates a customer exposure window and can leave grant-pinned v3 authority behind;
- testing only on a preview issuer, which does not prove the production issuer, audience, callback, host, or scheduler contract; or
- minting a token directly, which bypasses the operator consent and authorization-code path that acceptance must prove.

## Non-goals

- No global v3 activation.
- No public v3 dynamic registration or metadata.
- No reusable internal OAuth bypass.
- No customer company, customer user, or existing OAuth connection may be selected.
- No send, payment, financial-document issue, deletion, mass-action, or regulatory authority.
- No worker activation and no customer routine.
- No generic staged-rollout platform beyond the exact immutable v3 exposure required by this vertical.

## Data boundary

Create `private.mcp_oauth_canary_bindings` with one row per dedicated client:

- `id`
- `oauth_client_id`
- `user_id`
- `company_id`
- `exposure_revision`
- `consent_catalog_revision`
- `expires_at`
- `disabled_at`
- `created_at`

The table has RLS enabled, no policies, and no direct grant to `anon`, `authenticated`, or `service_role`. Only search-path-pinned `SECURITY DEFINER` functions callable by `service_role` may inspect or mutate it. Foreign keys bind the row to the exact client, user, company, and membership facts already used by OAuth.

The database accepts only exposure `2026-08-30.mcp-exposure.v3`, the matching immutable consent catalog, and a short bounded expiry. One client cannot have multiple bindings. Disabling or expiry is terminal for new consent, code exchange, refresh, and bearer resolution. Provisioning is idempotent for identical bytes and conflicts on any reuse with different facts.

## Provisioning boundary

A repository-owned production script provisions the canary through service-role RPCs. It accepts secrets and exact identifiers only through environment variables and prints no token, company data, user data, or identifiers. It:

1. verifies the selected company is a dedicated synthetic company and explicitly rejects the production `PERSONA TEST POOL` fixture;
2. verifies the selected user is an active member of that company and has every current granular day-closeout permission;
3. registers one public OAuth client pinned to the exact v3 scope ceiling and an already allowlisted host callback;
4. creates the exact canary binding; and
5. starts an exact loopback callback with fresh PKCE and state, opens the production consent URL locally, and prints only a safe readiness summary.

The authorization URL, code, PKCE verifier, tokens, and identifiers never enter stdout or repository artifacts. If binding creation fails after client registration, the script disables the inert client before returning failure. Replays either return the same safe state or fail on conflicting facts.

## Exposure resolution

Introduce one server-only resolver used by consent context, consent decision, authorization-code exchange, refresh, and bearer validation.

The resolver returns:

- active v2 for all ordinary requests and existing v1/v2 grant-pinned refresh behavior; or
- v3 only when the client, user, company, exposure, consent catalogue, membership, enabled state, and unexpired canary binding all match.

Routes never accept an exposure revision from request input. They derive it from the registered client plus current database authority. Public dynamic registration continues to call `resolveActiveMcpExposure()` and therefore continues producing only v2 clients.

### Consent context

After Firebase authentication and client lookup, the route resolves the effective exposure for the current authenticated user and company. Ordinary clients receive v2. The exact bound canary client receives v3. The preview stores that immutable revision and the exact seven accepted labels.

### Consent decision

The route consumes the one-time preview, then resolves the effective exposure again before creating a code. Expiry, disablement, membership loss, client mismatch, company mismatch, user mismatch, revision mismatch, or label drift produces the same opaque `invalid_request` response and no redirect.

### Authorization-code exchange

After atomically consuming the code, the token route resolves the effective exposure from the code's persisted client, user, company, revision, and catalogue facts. The database mint function independently performs the same canary check in the transaction that creates the grant. A failed check consumes no authority and returns the existing opaque `invalid_grant` result.

### Refresh

Refresh rotation remains single-use and family-revoking on replay. A v3 family rotates only while its exact canary binding is current and unexpired. Binding expiry or disablement revokes that canary grant family and returns `invalid_grant`. Existing v1/v2 refresh behavior remains byte-compatible.

### Bearer and MCP transport

Every v3 bearer resolution rechecks the exact canary binding before returning actor facts. Expired or disabled canary authority fails as an ordinary invalid bearer before tool discovery or business reads. V1/v2 grant-pinned behavior is unchanged. A valid v3 bearer resolves the existing immutable v3 server factory and therefore discovers exactly `prepare_day_closeout`.

## Routine safety

The worker remains globally disabled during canary acceptance. The canary grant may create and disable one synthetic routine configuration through the signed-in OPS settings surface, proving the handoff contract without executing scheduled business work.

Any v3 routine authority assertion must also require either a current canary binding or a later explicit global-v3 activation state. For this phase, only the current exact canary binding qualifies. Binding disablement, expiry, client disablement, grant revocation, token-family revocation, membership loss, or permission loss disables and de-leases the synthetic routine before any business read.

Global v3 activation is a separate release. Its migration changes the authority predicate from “exact canary only” to “active global v3 or exact canary,” and its application change updates the public exposure constant. Existing canary grants remain canary-bound until revoked and reconsented; activation never silently widens them.

## Acceptance and cleanup

The live acceptance sequence is fixed:

1. Provision one dedicated synthetic client and binding.
2. Jackson signs into that synthetic OPS company and approves the exact seven-scope consent.
3. Exchange the production code with PKCE and run the privacy-safe host runner.
4. Prove initialize, exact one-tool discovery, schema-valid prepare, immutable approval preview, exact OPS confirmation, idempotent commit, and truthful receipt readback.
5. Prove refresh rotation, spent-token reuse family revocation, bearer rejection, grant revocation, and routine disable/de-lease.
6. Confirm zero send, payment, issue, deletion, mass-action, or cross-tenant effect.
7. Disable the canary binding and client, revoke remaining grant material, and independently read back zero active canary authority.

The runner output remains aggregate-only. It prints contract revisions and pass/fail stages, never bearer or refresh material, business strings, entity identifiers, redirect codes, or raw transport errors.

## Failure behavior

- All externally visible OAuth failures reuse existing opaque errors.
- Provisioning failures leave no active binding; orphan clients are disabled.
- A canary mismatch never falls back from requested v3 scopes to v2.
- Expiry or disablement cannot be extended by refresh.
- Revocation during a prepare or commit window is caught by the existing current-authority and persistence rechecks.
- No failure is represented as a successful or partial closeout result.

## Verification

Required automated proof:

- real PostgreSQL migration tests for ACLs, RLS, search path, exact binding, idempotent replay, conflict, expiry, disablement, membership loss, cross-user, cross-company, cross-client, and cleanup;
- route tests for ordinary v2 bytes and exact v3 canary consent/context/decision/code/refresh paths;
- bearer and grant-pinned server tests proving v1/v2 compatibility and exact one-tool v3 discovery;
- adversarial tests for request-supplied revision, scope widening, stale preview, code replay, refresh replay, redirect mismatch, and opaque errors;
- routine tests proving canary loss disables and de-leases before reads;
- a clean Node 22 typecheck, lint-equivalent check, focused suite, real SQL contracts, and production build; and
- live post-release readback of zero customer rows, unchanged twenty-scope v2 metadata, protected-route 401s, no runtime errors, and disabled worker state before provisioning.

## Release order

1. Apply the canary schema and independently verify functions, ACLs, and zero rows.
2. Deploy the resolver and route changes with no canary binding present.
3. Re-prove public v2 metadata, existing v1/v2 compatibility, worker-off state, and runtime health.
4. Provision one short-lived synthetic binding and perform acceptance.
5. Clean up all canary authority.
6. Bring Jackson the evidence-backed activation decision. Do not activate v3 or the worker without his explicit go.
