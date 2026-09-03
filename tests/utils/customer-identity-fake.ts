/**
 * In-memory stand-in for the customer identity system RPCs and the customer
 * auth project's admin client, modelled on the binding P1 contract
 * (specs/plans/2026-09-01-public-api-identity-P1-plan.md, "Database
 * migration"). Route tests run the real broker library against this fake so
 * every assertion is about HTTP behaviour and policy, never about SQL.
 *
 * It records every call so a test can prove what the broker did — and, just
 * as important, what it never did (no Supabase session persisted, no raw id
 * returned, no data touched after a refusal).
 */

import { randomUUID } from "node:crypto";

import type { CustomerIdentityDeps } from "@/lib/customer-identity/config";
import type {
  CustomerAuthAdminClient,
  CustomerIdentityRpcClient,
  MembershipOutcome,
  MembershipState,
} from "@/lib/customer-identity/rpc";

export const FAKE_KEY_RING = Object.freeze({
  activeKid: 1,
  keys: new Map([[1, Buffer.alloc(32, 7)]]) as ReadonlyMap<number, Buffer>,
});

export interface FakeChallenge {
  emailDigest: string;
  networkFingerprint: string;
  attempts: number;
  consumed: boolean;
}

export interface FakeSession {
  sessionId: string;
  identityId: string;
  status: "ok" | "expired" | "revoked";
  networkFingerprint: string;
}

export interface FakeMembershipRow {
  membership_id: string;
  client_id: string;
  sub_client_id: string | null;
  state: MembershipState;
  outcome: MembershipOutcome;
}

export interface FakeProfile {
  display_name: string | null;
  contact_email_masked: string;
  membership_state: MembershipState | "none";
}

export interface RecordedRpc {
  fn: string;
  args: Record<string, unknown>;
}

export interface FakeCompany {
  id: string;
  deleted_at: string | null;
}

export interface FakeBookingPolicy {
  mode: "off" | "request" | "instant";
  timezone: string;
  visit_duration_minutes: number;
  horizon_days: number;
  min_notice_hours: number;
  slot_granularity_minutes: 15 | 30 | 60 | 120;
}

export const OFF_BOOKING_POLICY: FakeBookingPolicy = Object.freeze({
  mode: "off",
  timezone: "UTC",
  visit_duration_minutes: 60,
  horizon_days: 21,
  min_notice_hours: 48,
  slot_granularity_minutes: 60,
});

export interface FakeIntent {
  intentId: string;
  companyId: string;
  integrationId: string;
  slotStartAt: string;
  holdExpiresAt: string;
  state: "held" | "verified" | "confirmed" | "submitted" | "expired" | "cancelled";
  networkFingerprint: string;
  challengeId: string | null;
  emailDigest: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactEmailEncrypted: string | null;
  answers: unknown;
  verifiedChannel: string | null;
  clientId: string | null;
  opportunityId: string | null;
  siteVisitId: string | null;
}

/** How supabase-js surfaces a plpgsql `raise exception ... using errcode`. */
function raiseBooking(message: string, code: string) {
  return { data: null, error: { code, message } };
}

interface RpcFailure {
  code?: string;
  message: string;
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "*";
  return `${email[0]}${"*".repeat(Math.max(1, at - 1))}${email.slice(at)}`;
}

export class CustomerIdentityFake {
  readonly calls: RecordedRpc[] = [];
  readonly events: Array<{ type: string; args: Record<string, unknown> }> = [];
  readonly challenges = new Map<string, FakeChallenge>();
  readonly identities = new Map<string, { authSubject: string; email: string }>();
  readonly sessions = new Map<string, FakeSession>();
  readonly memberships = new Map<string, FakeMembershipRow | null>();
  readonly linkTargets = new Map<string, FakeMembershipRow | null>();
  /**
   * Every client the create-capable RPC minted. The read and sign-in paths
   * must never add to this: it is the fake's stand-in for a row appearing in
   * a live company's data (I17, I18).
   */
  readonly createdClients: Array<{ identityId: string; companyId: string; clientId: string }> = [];
  readonly profiles = new Map<string, FakeProfile>();
  readonly companies = new Map<string, FakeCompany>();
  readonly companyQueries: Array<{ columns: string; handle: string }> = [];

  /** Guest booking state (design P2 section 4). */
  readonly bookingPolicies = new Map<string, FakeBookingPolicy>();
  readonly availability = new Map<string, string[]>();
  readonly intents = new Map<string, FakeIntent>();
  readonly integrations = new Map<string, string>();

  /** Customer auth project state. */
  readonly authUsers = new Map<string, string>();
  readonly codes = new Map<string, string>();
  readonly otpSends: string[] = [];
  /** Every (email, token) pair proxied to the provider's code check. */
  readonly otpVerifies: Array<{ email: string; token: string }> = [];
  readonly appMetadataWrites: Array<{ uid: string; attributes: unknown }> = [];

  /** Policy knobs. */
  retryAfterSeconds = 60;
  refuseSends = false;
  sendError: unknown = null;
  private readonly failures = new Map<string, RpcFailure>();
  companyLookupFailure: RpcFailure | null = null;
  /** Force the hold RPC's single refusal branch regardless of live state. */
  holdRefusal = false;
  /**
   * Stand in for the manageability read the P2-1 migration has not shipped:
   * the broker must fail closed and send no code while it is absent.
   */
  manageableRpcMissing = false;
  /** Force the I12 replay refusal at confirm and at reschedule. */
  slotGoneOnConfirm = false;
  /** Refuse the intent at the contact or manage step (wrong state, wrong company). */
  refuseIntent = false;
  /** I13 caps, mirrored so a route test can prove them without SQL. */
  maxHoldsPerFingerprint = 3;
  maxHoldsPerCompany = 10;

  failOn(fn: string, failure: RpcFailure): this {
    this.failures.set(fn, failure);
    return this;
  }

  clearFailures(): this {
    this.failures.clear();
    this.companyLookupFailure = null;
    return this;
  }

  addCompany(handle: string, company: FakeCompany): this {
    this.companies.set(handle, company);
    return this;
  }

  /** Preset the membership the read and link RPCs report; `null` = none. */
  setMembership(
    identityId: string,
    companyId: string,
    row: FakeMembershipRow | null
  ): this {
    this.memberships.set(`${identityId}:${companyId}`, row);
    return this;
  }

  /**
   * What sign-in finds on file. Preset a row to stand for a verified email
   * that matches exactly one live client; leave it unset and the link RPC
   * establishes nothing, exactly as the database does when nothing matches
   * (I18).
   */
  setLinkTarget(
    identityId: string,
    companyId: string,
    row: FakeMembershipRow | null
  ): this {
    this.linkTargets.set(`${identityId}:${companyId}`, row);
    return this;
  }

  setProfile(identityId: string, companyId: string, profile: FakeProfile): this {
    this.profiles.set(`${identityId}:${companyId}`, profile);
    return this;
  }

  /** Seed an identity that has already signed in before. */
  seedIdentity(identityId: string, authSubject: string, email: string): this {
    this.identities.set(identityId, { authSubject, email });
    this.authUsers.set(email, authSubject);
    return this;
  }

  /** Seed a live session by its storage digest. */
  seedSession(
    sessionHash: string,
    session: Omit<FakeSession, "sessionId"> & { sessionId?: string }
  ): this {
    this.sessions.set(sessionHash, {
      sessionId: session.sessionId ?? randomUUID(),
      identityId: session.identityId,
      status: session.status,
      networkFingerprint: session.networkFingerprint,
    });
    return this;
  }

  callsTo(fn: string): RecordedRpc[] {
    return this.calls.filter((call) => call.fn === fn);
  }

  eventTypes(): string[] {
    return this.events.map((event) => event.type);
  }

  identityByAuthSubject(authSubject: string): string | null {
    for (const [identityId, identity] of this.identities) {
      if (identity.authSubject === authSubject) return identityId;
    }
    return null;
  }

  /** Give a company a live booking policy; absent means `mode = 'off'`. */
  setBookingPolicy(companyId: string, policy: Partial<FakeBookingPolicy>): this {
    this.bookingPolicies.set(companyId, { ...OFF_BOOKING_POLICY, ...policy });
    return this;
  }

  /** The slot starts the availability RPC would offer, as ISO instants. */
  setAvailability(companyId: string, slots: readonly (string | Date)[]): this {
    this.availability.set(
      companyId,
      slots.map((slot) => (slot instanceof Date ? slot.toISOString() : slot))
    );
    return this;
  }

  bookingPolicyFor(companyId: string): FakeBookingPolicy {
    return this.bookingPolicies.get(companyId) ?? OFF_BOOKING_POLICY;
  }

  /** Seed an intent in any state — the shortcut into the middle of a flow. */
  seedIntent(intent: Partial<FakeIntent> & { companyId: string }): FakeIntent {
    const seeded: FakeIntent = {
      intentId: intent.intentId ?? randomUUID(),
      companyId: intent.companyId,
      integrationId: intent.integrationId ?? randomUUID(),
      slotStartAt: intent.slotStartAt ?? new Date(Date.now() + 86_400_000).toISOString(),
      holdExpiresAt:
        intent.holdExpiresAt ?? new Date(Date.now() + 5 * 60_000).toISOString(),
      state: intent.state ?? "held",
      networkFingerprint: intent.networkFingerprint ?? "f".repeat(64),
      challengeId: intent.challengeId ?? null,
      emailDigest: intent.emailDigest ?? null,
      contactName: intent.contactName ?? null,
      contactEmail: intent.contactEmail ?? null,
      contactPhone: intent.contactPhone ?? null,
      contactEmailEncrypted: intent.contactEmailEncrypted ?? null,
      answers: intent.answers ?? [],
      verifiedChannel: intent.verifiedChannel ?? null,
      clientId: intent.clientId ?? null,
      opportunityId: intent.opportunityId ?? null,
      siteVisitId: intent.siteVisitId ?? null,
    };
    this.intents.set(seeded.intentId, seeded);
    return seeded;
  }

  liveHolds(predicate: (intent: FakeIntent) => boolean): number {
    let count = 0;
    for (const intent of this.intents.values()) {
      if (intent.state === "held" && Date.parse(intent.holdExpiresAt) > Date.now()) {
        if (predicate(intent)) count += 1;
      }
    }
    return count;
  }

  /** A slot is offered only while it is in the preset list and unclaimed. */
  private slotIsOffered(companyId: string, slotStartAt: string): boolean {
    const offered = this.availability.get(companyId) ?? [];
    if (!offered.includes(slotStartAt)) return false;
    for (const intent of this.intents.values()) {
      if (intent.companyId !== companyId) continue;
      if (intent.slotStartAt !== slotStartAt) continue;
      if (intent.state === "confirmed" || intent.state === "submitted") return false;
      if (intent.state === "held" && Date.parse(intent.holdExpiresAt) > Date.now()) {
        return false;
      }
    }
    return true;
  }

  private intentFor(intentId: unknown, companyId: unknown): FakeIntent | null {
    const intent = this.intents.get(String(intentId));
    if (!intent || intent.companyId !== String(companyId)) return null;
    return intent;
  }

  /** The challenge is proof only once the code has actually been checked. */
  private challengeProven(intent: FakeIntent, challengeId: unknown): boolean {
    if (intent.challengeId === null) return false;
    if (intent.challengeId !== String(challengeId)) return false;
    return this.challenges.get(intent.challengeId)?.consumed === true;
  }

  /** What the read RPC reports: the stored membership, or nothing. */
  private membershipFor(identityId: string, companyId: string): FakeMembershipRow | null {
    return this.memberships.get(`${identityId}:${companyId}`) ?? null;
  }

  /**
   * Sign-in: an existing membership is reported as it stands, a preset link
   * target is established forward-only, and anything else establishes nothing.
   * No client is ever created here.
   */
  private linkFor(identityId: string, companyId: string): FakeMembershipRow | null {
    const key = `${identityId}:${companyId}`;
    const existing = this.memberships.get(key) ?? null;
    if (existing) return { ...existing, outcome: "existing" };
    const target = this.linkTargets.get(key) ?? null;
    if (target === null) return null;
    this.memberships.set(key, target);
    return target;
  }

  /** The intent paths only: creates the customer's own client when nothing matched. */
  private resolveOrCreateFor(identityId: string, companyId: string): FakeMembershipRow {
    const linked = this.linkFor(identityId, companyId);
    if (linked !== null) return linked;
    const clientId = randomUUID();
    const created: FakeMembershipRow = {
      membership_id: randomUUID(),
      client_id: clientId,
      sub_client_id: null,
      state: "active_full",
      outcome: "created",
    };
    this.memberships.set(`${identityId}:${companyId}`, created);
    this.createdClients.push({ identityId, companyId, clientId });
    return created;
  }

  private profileFor(identityId: string, companyId: string): FakeProfile {
    const preset = this.profiles.get(`${identityId}:${companyId}`);
    if (preset) return preset;
    const identity = this.identities.get(identityId);
    const membership = this.memberships.get(`${identityId}:${companyId}`) ?? null;
    return {
      display_name: null,
      contact_email_masked: maskEmail(identity?.email ?? "x@example.com"),
      membership_state: membership?.state ?? "none",
    };
  }

  private async dispatch(
    fn: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: unknown }> {
    this.calls.push({ fn, args: { ...args } });
    const failure = this.failures.get(fn);
    if (failure) return { data: null, error: failure };

    switch (fn) {
      case "begin_customer_otp_challenge_as_system": {
        if (this.refuseSends) {
          return {
            data: [
              {
                challenge_id: null,
                allowed: false,
                retry_after_seconds: this.retryAfterSeconds,
              },
            ],
            error: null,
          };
        }
        const id = randomUUID();
        this.challenges.set(id, {
          emailDigest: String(args.p_email_digest),
          networkFingerprint: String(args.p_network_fingerprint),
          attempts: 0,
          consumed: false,
        });
        return {
          data: [
            { challenge_id: id, allowed: true, retry_after_seconds: this.retryAfterSeconds },
          ],
          error: null,
        };
      }
      case "record_customer_otp_attempt_as_system": {
        const challenge = this.challenges.get(String(args.p_challenge_id));
        if (!challenge || challenge.consumed) return { data: [], error: null };
        if (args.p_success === true) {
          challenge.consumed = true;
          return {
            data: [{ attempts: challenge.attempts, exhausted: false }],
            error: null,
          };
        }
        challenge.attempts += 1;
        const exhausted = challenge.attempts > 5;
        if (exhausted) challenge.consumed = true;
        return {
          data: [{ attempts: challenge.attempts, exhausted }],
          error: null,
        };
      }
      case "upsert_customer_identity_as_system": {
        const authSubject = String(args.p_auth_subject);
        const email = String(args.p_email);
        const existing = this.identityByAuthSubject(authSubject);
        if (existing) {
          return { data: [{ identity_id: existing, created: false }], error: null };
        }
        for (const identity of this.identities.values()) {
          if (identity.email === email) {
            return {
              data: null,
              error: {
                code: "23505",
                message: "duplicate key value violates unique constraint customer_contact_conflict",
              },
            };
          }
        }
        const identityId = randomUUID();
        this.identities.set(identityId, { authSubject, email });
        return { data: [{ identity_id: identityId, created: true }], error: null };
      }
      case "mint_customer_session_as_system": {
        const sessionId = randomUUID();
        this.sessions.set(String(args.p_session_hash), {
          sessionId,
          identityId: String(args.p_identity_id),
          status: "ok",
          networkFingerprint: String(args.p_network_fingerprint),
        });
        return { data: sessionId, error: null };
      }
      case "resolve_customer_session_as_system": {
        const session = this.sessions.get(String(args.p_session_hash));
        if (!session) {
          return {
            data: [{ identity_id: null, session_id: null, status: "unknown" }],
            error: null,
          };
        }
        return {
          data: [
            {
              identity_id: session.status === "ok" ? session.identityId : null,
              session_id: session.status === "ok" ? session.sessionId : null,
              status: session.status,
            },
          ],
          error: null,
        };
      }
      case "revoke_customer_session_as_system": {
        const session = this.sessions.get(String(args.p_session_hash));
        if (!session || session.status === "revoked") return { data: false, error: null };
        session.status = "revoked";
        return { data: true, error: null };
      }
      case "revoke_all_customer_sessions_as_system": {
        let count = 0;
        for (const session of this.sessions.values()) {
          if (session.identityId === args.p_identity_id && session.status === "ok") {
            session.status = "revoked";
            count += 1;
          }
        }
        return { data: count, error: null };
      }
      case "read_customer_membership_as_system": {
        const row = this.membershipFor(String(args.p_identity_id), String(args.p_company_id));
        return { data: row === null ? [] : [row], error: null };
      }
      case "link_customer_membership_as_system": {
        const row = this.linkFor(String(args.p_identity_id), String(args.p_company_id));
        return { data: row === null ? [] : [row], error: null };
      }
      case "resolve_or_create_customer_membership_as_system": {
        const row = this.resolveOrCreateFor(
          String(args.p_identity_id),
          String(args.p_company_id)
        );
        return { data: [row], error: null };
      }
      case "read_customer_profile_as_system": {
        return {
          data: [this.profileFor(String(args.p_identity_id), String(args.p_company_id))],
          error: null,
        };
      }
      case "append_customer_identity_event_as_system": {
        this.events.push({ type: String(args.p_event_type), args: { ...args } });
        return { data: null, error: null };
      }
      // ─── Guest booking, as migration 20260902190000 landed it ────────────
      case "ensure_customer_hosted_integration_as_system": {
        const companyId = String(args.p_company_id);
        let integrationId = this.integrations.get(companyId);
        if (!integrationId) {
          integrationId = randomUUID();
          this.integrations.set(companyId, integrationId);
        }
        return { data: integrationId, error: null };
      }
      case "read_public_booking_policy_as_system": {
        const policy = this.bookingPolicies.get(String(args.p_company_id));
        // The RPC filters `mode <> 'off'`, so a company that does not take
        // bookings simply has no row.
        if (!policy || policy.mode === "off") return { data: [], error: null };
        return {
          data: [
            {
              mode: policy.mode,
              timezone: policy.timezone,
              visit_duration_minutes: policy.visit_duration_minutes,
              min_notice_hours: policy.min_notice_hours,
              horizon_days: policy.horizon_days,
            },
          ],
          error: null,
        };
      }
      case "read_public_availability_as_system": {
        const companyId = String(args.p_company_id);
        if (this.bookingPolicyFor(companyId).mode === "off") {
          return { data: [], error: null };
        }
        const from = Date.parse(`${String(args.p_from)}T00:00:00.000Z`);
        const to = Date.parse(`${String(args.p_to)}T23:59:59.999Z`);
        const rows = (this.availability.get(companyId) ?? [])
          .filter((slot) => {
            const at = Date.parse(slot);
            return at >= from && at <= to && this.slotIsOffered(companyId, slot);
          })
          .sort()
          .map((slot) => ({ slot_start_at: slot }));
        return { data: rows, error: null };
      }
      case "hold_booking_slot_as_system": {
        const companyId = String(args.p_company_id);
        const slot = new Date(String(args.p_slot_start_at)).toISOString();
        const fingerprint = String(args.p_network_fingerprint);
        // One refusal shape for every reason, exactly as the migration does.
        const refuse = (retryAfterSeconds: number) => ({
          data: [
            {
              intent_id: null,
              hold_expires_at: null,
              allowed: false,
              retry_after_seconds: retryAfterSeconds,
            },
          ],
          error: null,
        });
        if (this.holdRefusal) return refuse(60);
        if (this.bookingPolicyFor(companyId).mode === "off") return refuse(60);
        if (!this.slotIsOffered(companyId, slot)) return refuse(60);
        if (
          this.liveHolds((intent) => intent.networkFingerprint === fingerprint) >=
          this.maxHoldsPerFingerprint
        ) {
          return refuse(this.retryAfterSeconds);
        }
        if (
          this.liveHolds((intent) => intent.companyId === companyId) >=
          this.maxHoldsPerCompany
        ) {
          return refuse(this.retryAfterSeconds);
        }
        const intent = this.seedIntent({
          companyId,
          integrationId: String(args.p_integration_id),
          slotStartAt: slot,
          networkFingerprint: fingerprint,
          holdExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        });
        return {
          data: [
            {
              intent_id: intent.intentId,
              hold_expires_at: intent.holdExpiresAt,
              allowed: true,
              retry_after_seconds: null,
            },
          ],
          error: null,
        };
      }
      case "record_guest_booking_contact_as_system": {
        const intent = this.intents.get(String(args.p_intent_id));
        const refused = {
          data: [
            {
              intent_id: String(args.p_intent_id),
              hold_expires_at: null,
              accepted: false,
            },
          ],
          error: null,
        };
        if (this.refuseIntent || !intent) return refused;
        if (intent.state !== "held" || Date.parse(intent.holdExpiresAt) <= Date.now()) {
          return refused;
        }
        intent.contactName = String(args.p_contact_name);
        intent.emailDigest = String(args.p_contact_email_digest);
        intent.contactEmailEncrypted = String(args.p_contact_email_encrypted);
        intent.contactPhone =
          args.p_contact_phone == null ? null : String(args.p_contact_phone);
        intent.answers = args.p_answers;
        return {
          data: [
            {
              intent_id: intent.intentId,
              hold_expires_at: intent.holdExpiresAt,
              accepted: true,
            },
          ],
          error: null,
        };
      }
      case "confirm_guest_booking_as_system": {
        const intent = this.intents.get(String(args.p_intent_id));
        if (!intent) return raiseBooking("booking_intent_not_found", "P0002");
        if (intent.state !== "held") {
          return raiseBooking("booking_intent_not_holdable", "55000");
        }
        if (Date.parse(intent.holdExpiresAt) <= Date.now()) {
          return raiseBooking("booking_hold_expired", "55000");
        }
        if (intent.emailDigest !== String(args.p_contact_email_digest)) {
          return raiseBooking("booking_contact_mismatch", "42501");
        }
        const policy = this.bookingPolicyFor(intent.companyId);
        if (policy.mode === "off") return raiseBooking("booking_not_available", "55000");
        if (this.slotGoneOnConfirm) {
          return raiseBooking("booking_slot_unavailable", "55000");
        }
        intent.verifiedChannel = String(args.p_verified_channel);
        intent.state = policy.mode === "instant" ? "confirmed" : "submitted";
        intent.clientId = intent.clientId ?? randomUUID();
        intent.opportunityId = intent.opportunityId ?? randomUUID();
        if (policy.mode === "instant") intent.siteVisitId = randomUUID();
        return {
          data: [
            {
              outcome: intent.state,
              intent_id: intent.intentId,
              client_id: intent.clientId,
              opportunity_id: intent.opportunityId,
              site_visit_id: intent.siteVisitId,
              scheduled_at: policy.mode === "instant" ? intent.slotStartAt : null,
            },
          ],
          error: null,
        };
      }
      case "read_guest_booking_manageable_as_system": {
        if (this.manageableRpcMissing) {
          return {
            data: null,
            error: {
              code: "PGRST202",
              message:
                "Could not find the function public.read_guest_booking_manageable_as_system",
            },
          };
        }
        const intent = this.intents.get(String(args.p_intent_id));
        const manageable =
          intent !== undefined &&
          intent.companyId === String(args.p_company_id) &&
          (intent.state === "confirmed" || intent.state === "submitted") &&
          intent.emailDigest === String(args.p_contact_email_digest);
        return { data: manageable, error: null };
      }
      case "reschedule_guest_booking_as_system": {
        const intent = this.intents.get(String(args.p_intent_id));
        if (!intent) return raiseBooking("booking_intent_not_found", "P0002");
        if (intent.state !== "confirmed" && intent.state !== "submitted") {
          return raiseBooking("booking_not_reschedulable", "55000");
        }
        const slot = new Date(String(args.p_scheduled_at)).toISOString();
        if (this.slotGoneOnConfirm || !this.slotIsOffered(intent.companyId, slot)) {
          return raiseBooking("booking_slot_unavailable", "55000");
        }
        intent.slotStartAt = slot;
        return {
          data: [
            {
              intent_id: intent.intentId,
              site_visit_id: intent.siteVisitId,
              scheduled_at: slot,
            },
          ],
          error: null,
        };
      }
      case "cancel_guest_booking_as_system": {
        const intent = this.intents.get(String(args.p_intent_id));
        if (!intent) return raiseBooking("booking_intent_not_found", "P0002");
        if (intent.state !== "confirmed" && intent.state !== "submitted") {
          return raiseBooking("booking_not_cancellable", "55000");
        }
        intent.state = "cancelled";
        return {
          data: [{ intent_id: intent.intentId, site_visit_id: intent.siteVisitId }],
          error: null,
        };
      }
      default:
        throw new Error(`customer identity fake: unexpected rpc ${fn}`);
    }
  }

  rpcClient(): CustomerIdentityRpcClient {
    return { rpc: (fn, args) => this.dispatch(fn, args as Record<string, unknown>) };
  }

  authClient(): CustomerAuthAdminClient {
    return {
      auth: {
        signInWithOtp: async ({ email }) => {
          this.otpSends.push(email);
          return { error: this.sendError };
        },
        verifyOtp: async ({ email, token }) => {
          this.otpVerifies.push({ email, token });
          if (this.codes.get(email) !== token) {
            return {
              data: { user: null, session: null },
              error: { code: "otp_expired", status: 403, message: "Token has expired or is invalid" },
            };
          }
          this.codes.delete(email);
          let authSubject = this.authUsers.get(email);
          if (!authSubject) {
            authSubject = randomUUID();
            this.authUsers.set(email, authSubject);
          }
          return {
            data: {
              user: { id: authSubject },
              session: {
                access_token: "eyJhbGciOiJIUzI1NiJ9.SUPABASE_ACCESS.sig",
                refresh_token: "supabase-refresh-token-value",
              },
            },
            error: null,
          };
        },
        admin: {
          updateUserById: async (uid, attributes) => {
            this.appMetadataWrites.push({ uid, attributes });
            return { error: null };
          },
        },
      },
    };
  }

  deps(): CustomerIdentityDeps {
    return Object.freeze({
      rpc: this.rpcClient(),
      auth: this.authClient(),
      keyRing: FAKE_KEY_RING,
    });
  }

  /**
   * The slice of the service-role client the broker routes use on the main
   * project: `companies` by `public_handle`. Anything else is a bug.
   */
  serviceRoleClient() {
    const lookup = async (columns: string, handle: string) => {
      this.companyQueries.push({ columns, handle });
      if (this.companyLookupFailure) {
        return { data: null, error: this.companyLookupFailure };
      }
      const company = this.companies.get(handle);
      return { data: company ? { ...company } : null, error: null };
    };
    return {
      from: (table: string) => {
        if (table !== "companies") {
          throw new Error(`customer identity fake: unexpected table ${table}`);
        }
        return {
          select: (columns: string) => ({
            eq: (column: string, value: string) => {
              if (column !== "public_handle") {
                throw new Error(`customer identity fake: unexpected filter ${column}`);
              }
              return { maybeSingle: () => lookup(columns, value) };
            },
          }),
        };
      },
      rpc: (fn: string, args: Record<string, unknown>) => this.dispatch(fn, args),
    };
  }
}
