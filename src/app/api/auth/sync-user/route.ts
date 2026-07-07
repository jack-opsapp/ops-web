/**
 * POST /api/auth/sync-user
 *
 * Syncs a Firebase-authenticated user with the Supabase `users` table.
 * - Verifies the Firebase ID token via jose JWKS verification
 * - Looks up the user by auth_id, then firebase_uid, then email — the email
 *   fallback resolves on the VERIFIED TOKEN email, never the caller-supplied
 *   body email (CRIT-3), and can never rewrite / hand back a row already bound
 *   to a different identity from an unverified email-only match
 * - Creates a new user record if none exists
 * - Updates last-login timestamp on existing users
 * - Sets `firebase_uid` from the verified token at creation and repairs
 *   null/stale values on login — every firebase_uid write is gated on the
 *   token being Firebase-issued so a Supabase-issued token can never seed the
 *   column with a Supabase auth UUID (audit risk R8 — the shared RPCs resolve
 *   identity via users.firebase_uid = JWT sub)
 * - Returns the user and their associated company (if any)
 *
 * Body: { idToken, email, displayName?, firstName?, lastName?, photoURL? }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  verifyAuthToken,
  isFirebaseIssuedToken,
} from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { parseDate } from "@/lib/supabase/helpers";
import { normalizeImageUrl } from "@/lib/utils/image-url";
import type {
  User,
  UserRole,
  Company,
  SubscriptionStatus,
  SubscriptionPlan,
  PaymentSchedule,
} from "@/lib/types/models";
import { UserRole as UserRoleEnum } from "@/lib/types/models";

// ─── Request Body ────────────────────────────────────────────────────────────

interface SyncUserBody {
  idToken: string;
  email: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  photoURL?: string;
  /** If false, returns 404 instead of auto-creating a user row.
   *  Defaults to true for backward compat (OAuth flows). */
  createIfMissing?: boolean;
}

// ─── DB Row Mappers ──────────────────────────────────────────────────────────

function mapUserFromDb(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    email: (row.email as string) ?? null,
    phone: (row.phone as string) ?? null,
    profileImageURL: normalizeImageUrl((row.profile_image_url as string) ?? null),
    role: (row.role as UserRole) ?? UserRoleEnum.Unassigned,
    companyId: (row.company_id as string) ?? null,
    userType: (row.user_type as User["userType"]) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    locationName: (row.location_name as string) ?? null,
    homeAddress: (row.home_address as string) ?? null,
    clientId: (row.client_id as string) ?? null,
    isActive: (row.is_active as boolean) ?? true,
    userColor: (row.user_color as string) ?? null,
    devPermission: (row.dev_permission as boolean) ?? false,
    onboardingCompleted: (row.onboarding_completed as User["onboardingCompleted"]) ?? {},
    hasCompletedAppTutorial: (row.has_completed_tutorial as boolean) ?? false,
    isCompanyAdmin: (row.is_company_admin as boolean) ?? false,
    specialPermissions: (row.special_permissions as string[]) ?? [],
    setupProgress: (row.setup_progress as User["setupProgress"]) ?? null,
    stripeCustomerId: (row.stripe_customer_id as string) ?? null,
    deviceToken: (row.device_token as string) ?? null,
    emergencyContactName: (row.emergency_contact_name as string) ?? null,
    emergencyContactPhone: (row.emergency_contact_phone as string) ?? null,
    emergencyContactRelationship: (row.emergency_contact_relationship as string) ?? null,
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: parseDate(row.deleted_at),
  };
}

function mapCompanyFromDb(row: Record<string, unknown>): Company {
  return {
    id: row.id as string,
    name: row.name as string,
    logoURL: normalizeImageUrl((row.logo_url as string) ?? null),
    externalId: (row.external_id as string) ?? null,
    companyCode: (row.company_code as string) ?? null,
    companyDescription: (row.description as string) ?? null,
    address: (row.address as string) ?? null,
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    website: (row.website as string) ?? null,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    openHour: (row.open_hour as string) ?? null,
    closeHour: (row.close_hour as string) ?? null,
    industries: (row.industries as string[]) ?? [],
    companySize: (row.company_size as string) ?? null,
    companyAge: (row.company_age as string) ?? null,
    referralMethod: (row.referral_method as string) ?? null,
    projectIds: [],
    teamIds: [],
    adminIds: (row.admin_ids as string[]) ?? [],
    accountHolderId: (row.account_holder_id as string) ?? null,
    defaultProjectColor: (row.default_project_color as string) ?? "#9CA3AF",
    teamMembersSynced: true,
    subscriptionStatus: (row.subscription_status as SubscriptionStatus) ?? null,
    subscriptionPlan: (row.subscription_plan as SubscriptionPlan) ?? null,
    subscriptionEnd: parseDate(row.subscription_end),
    subscriptionPeriod: (row.subscription_period as PaymentSchedule) ?? null,
    maxSeats: (row.max_seats as number) ?? 10,
    seatedEmployeeIds: (row.seated_employee_ids as string[]) ?? [],
    seatGraceStartDate: parseDate(row.seat_grace_start_date),
    trialStartDate: parseDate(row.trial_start_date),
    trialEndDate: parseDate(row.trial_end_date),
    hasPrioritySupport: (row.has_priority_support as boolean) ?? false,
    dataSetupPurchased: (row.data_setup_purchased as boolean) ?? false,
    dataSetupCompleted: (row.data_setup_completed as boolean) ?? false,
    dataSetupScheduledDate: parseDate(row.data_setup_scheduled),
    stripeCustomerId: (row.stripe_customer_id as string) ?? null,
    defaultWorkStart: (row.default_work_start as string) ?? "08:00:00",
    defaultWorkEnd: (row.default_work_end as string) ?? "17:00:00",
    lastSyncedAt: null,
    needsSync: false,
    deletedAt: parseDate(row.deleted_at),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchCompanyById(companyId: string): Promise<Company | null> {
  const db = getServiceRoleClient();
  const { data, error } = await db
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .is("deleted_at", null)
    .single();

  if (error || !data) return null;
  return mapCompanyFromDb(data);
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as SyncUserBody;
    const { idToken, email, displayName, firstName, lastName, photoURL, createIfMissing = true } = body;

    if (!idToken || !email) {
      return NextResponse.json(
        { error: "Missing required fields: idToken, email" },
        { status: 400 }
      );
    }

    // Verify auth token (Supabase or Firebase)
    const firebaseUser = await verifyAuthToken(idToken);
    const firebaseUid = firebaseUser.uid;

    const db = getServiceRoleClient();

    // Look up existing user by auth_id, firebase_uid, then email
    const { data: byAuthId } = await db
      .from("users")
      .select("*")
      .eq("auth_id", firebaseUid)
      .is("deleted_at", null)
      .maybeSingle();

    let existingRow = byAuthId;

    if (!existingRow) {
      const { data: byFirebaseUid } = await db
        .from("users")
        .select("*")
        .eq("firebase_uid", firebaseUid)
        .is("deleted_at", null)
        .maybeSingle();

      existingRow = byFirebaseUid;
    }

    // Email fallback is resolved on the VERIFIED TOKEN email, never the caller-
    // supplied body email (CRIT-3): the body email is attacker-controllable
    // independently of the signed token. `matchedByEmail` flags a row found
    // only by email (not by the cryptographic sub) — it gates the identity
    // writes below.
    let matchedByEmail = false;
    if (!existingRow) {
      const tokenEmail = firebaseUser.email;
      if (tokenEmail) {
        const { data: byEmail } = await db
          .from("users")
          .select("*")
          .eq("email", tokenEmail)
          .is("deleted_at", null)
          .maybeSingle();

        existingRow = byEmail;
        matchedByEmail = Boolean(byEmail);
      }
    }

    // ── Existing user: update last login and auth_id ──
    if (existingRow) {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      // CRIT-3 — account-takeover guard. A row matched ONLY by email that is
      // already bound to a DIFFERENT identity (a non-null auth_id/firebase_uid
      // that isn't this token's sub) must not have its identity rewritten, nor
      // be handed back, to a caller who has not proven ownership of the address.
      // OPS never sends Firebase email verification, so email/password tokens
      // are permanently email_verified=false; the legacy-link path (an UNCLAIMED
      // row — both identity columns null) therefore stays open so the ~75% of
      // users whose rows predate firebase_uid-at-creation can still attach on
      // first web login. Sub-matched rows are provably the caller's. The full
      // closure (re-key the RLS helpers off the token sub + roll out email
      // verification + backfill the unlinked rows) is the documented follow-up;
      // this stops the clearest hijack — rewriting / handing back an already-
      // linked account from an unverified email-only match.
      const emailVerified = firebaseUser.claims.email_verified === true;
      const claimedByDifferentIdentity =
        matchedByEmail &&
        ((existingRow.firebase_uid != null &&
          existingRow.firebase_uid !== firebaseUid) ||
          (existingRow.auth_id != null && existingRow.auth_id !== firebaseUid));

      if (claimedByDifferentIdentity && !emailVerified) {
        console.warn(
          "[sync-user] Refused unverified email-only match against a row bound to a different identity",
          { rowId: existingRow.id }
        );
        return NextResponse.json(
          { error: "Email verification required to access this account." },
          { status: 403 }
        );
      }

      // Ensure auth_id is set (only ever sets a NULL column — never overwrites).
      if (!existingRow.auth_id) {
        updates.auth_id = firebaseUid;
      }

      // firebase_uid must mirror the VERIFIED token's uid (audit risk R8 — the
      // shared RPCs resolve identity via users.firebase_uid = JWT sub).
      // Backfill legacy null rows AND repair stale/divergent values. Gated on
      // the token being Firebase-issued so a Supabase-issued token (sub =
      // Supabase auth UUID) can never clobber a real Firebase UID. The
      // claimed-by-different-identity guard above has already rejected an
      // unverified email-only match against a row linked to another sub, so
      // reaching here means the rewrite is the caller's own row (or the email
      // is verified).
      if (
        isFirebaseIssuedToken(firebaseUser.claims) &&
        existingRow.firebase_uid !== firebaseUid
      ) {
        updates.firebase_uid = firebaseUid;
      }

      // Update profile fields if provided and currently empty
      if (photoURL && !existingRow.profile_image_url) {
        updates.profile_image_url = photoURL;
      }
      if (firstName && !existingRow.first_name) {
        updates.first_name = firstName;
      }
      if (lastName && !existingRow.last_name) {
        updates.last_name = lastName;
      }

      const { error: updateError } = await db.from("users").update(updates).eq("id", existingRow.id);
      if (updateError) {
        console.error("[sync-user] Failed to update user auth fields:", updateError.message);
      }

      const user = mapUserFromDb({ ...existingRow, ...updates });
      const company = user.companyId ? await fetchCompanyById(user.companyId) : null;

      return NextResponse.json({ user, company });
    }

    // ── New user ──
    if (!createIfMissing) {
      return NextResponse.json(
        { error: "No account found for this email. Please sign up first." },
        { status: 404 }
      );
    }

    // Create record
    const derivedFirst = firstName || displayName?.split(" ")[0] || "";
    const derivedLast = lastName || displayName?.split(" ").slice(1).join(" ") || "";

    // auth_id is provider-agnostic by design — it maps the verified token's
    // sub (Supabase auth UUID for iOS, Firebase UID for web) to the app user;
    // RLS helpers resolve identity via auth_id, so it must be written for both
    // providers. firebase_uid must only ever hold Firebase UIDs (audit risk R8
    // — the shared RPCs resolve identity via users.firebase_uid = JWT sub), so
    // it carries the same Firebase-issued gate as the backfill above: a
    // Supabase-issued token creating a row must not seed the column with a
    // Supabase auth UUID.
    const newRow = {
      auth_id: firebaseUid,
      firebase_uid: isFirebaseIssuedToken(firebaseUser.claims)
        ? firebaseUid
        : null,
      email,
      first_name: derivedFirst,
      last_name: derivedLast,
      profile_image_url: photoURL ?? null,
      role: UserRoleEnum.Unassigned,
      is_active: true,
      is_company_admin: false,
      onboarding_completed: {},
      has_completed_tutorial: false,
      dev_permission: false,
    };

    const { data: inserted, error: insertError } = await db
      .from("users")
      .insert(newRow)
      .select("*")
      .single();

    if (insertError || !inserted) {
      // Race recovery: a concurrent sync-user call (e.g. JoinPage and
      // AuthProvider firing in parallel right after an OAuth sign-in)
      // may have committed an insert for the same firebase_uid between
      // our lookup and our insert. Postgres unique_violation is code
      // 23505 — re-fetch the row that raced us and return it as if
      // this call had created it, so both callers see a 200.
      if ((insertError as { code?: string } | null)?.code === "23505") {
        // Look up by auth_id first (always written at creation for both
        // providers), then firebase_uid (covers legacy rows whose auth_id
        // diverged) — a Supabase-token raced row has firebase_uid = null, so a
        // firebase_uid-only lookup would miss it.
        let { data: raced } = await db
          .from("users")
          .select("*")
          .eq("auth_id", firebaseUid)
          .is("deleted_at", null)
          .maybeSingle();
        if (!raced) {
          ({ data: raced } = await db
            .from("users")
            .select("*")
            .eq("firebase_uid", firebaseUid)
            .is("deleted_at", null)
            .maybeSingle());
        }
        if (raced) {
          const user = mapUserFromDb(raced);
          const company = user.companyId ? await fetchCompanyById(user.companyId) : null;
          return NextResponse.json({ user, company });
        }
      }
      return NextResponse.json(
        { error: `Failed to create user: ${insertError?.message ?? "Unknown error"}` },
        { status: 500 }
      );
    }

    const user = mapUserFromDb(inserted);
    return NextResponse.json({ user, company: null });
  } catch (error) {
    console.error("[api/auth/sync-user] Error:", error);

    // Catch JWT verification failures (jose library errors)
    const msg = error instanceof Error ? error.message : "";
    if (
      msg.includes("Token") ||
      msg.includes("iss") ||
      msg.includes("exp") ||
      msg.includes("aud") ||
      msg.includes("JWK") ||
      msg.includes("signature") ||
      msg.includes("verification")
    ) {
      return NextResponse.json(
        { error: "Authentication failed. Please try signing in again." },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
