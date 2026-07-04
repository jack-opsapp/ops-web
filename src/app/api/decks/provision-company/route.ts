/**
 * POST /api/decks/provision-company
 *
 * Bootstraps the account context for the standalone Deckset iOS app after
 * Firebase sign-in. Implements the Phase-1 backend contract: an idempotent
 * company-of-one keyed on the verified Firebase subject.
 *
 *  - Existing user with a company → returns it untouched (an OPS user who
 *    installs Deckset lands in their real company).
 *  - Existing user without a company → resumes provisioning.
 *  - Brand-new identity → creates the users row, then delegates company
 *    creation to the provision_deck_company RPC, which wraps the hardened
 *    create_company_for_owner path (advisory lock, TOCTOU guard, owner role
 *    seed, company defaults) and stamps companies.source_app = 'ops_decks'
 *    in the same transaction.
 *
 * Deck entitlement is never written to companies.subscription_* — the
 * platform trial trigger applies its uniform defaults and the Deckset app
 * reads entitlement exclusively from deck_subscriptions.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  verifyDecksRequestAuth,
  type DecksVerifiedAuth,
} from "@/lib/decks/route-auth";
import { DECKSET_SOURCE_APP } from "@/lib/decks/billing/stripe-deckset";

/**
 * Contract constant marking the provisioning context for the Deckset app.
 * Intentionally NOT a companies.subscription_plan value (that column's CHECK
 * pins OPS plans and must never carry deck entitlement).
 */
const DECKS_SUBSCRIPTION_PLAN = "decks";

const provisionBodySchema = z.object({
  firebase_uid: z.string().min(1),
  email: z.string().email(),
  display_name: z.string().nullable().optional(),
  source_app: z.literal(DECKSET_SOURCE_APP),
});

interface ProvisionedUserRow {
  id: string;
  company_id: string | null;
  role: string | null;
  firebase_uid: string | null;
}

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await verifyDecksRequestAuth(req, {
    logTag: "[decks/provision-company]",
    unavailableMessage: "Provisioning unavailable",
    errorShape: "code",
  });
  if (auth instanceof NextResponse) return auth;

  const body = await readProvisionBody(req);
  if (body instanceof NextResponse) return body;

  if (body.firebase_uid !== auth.uid) {
    return NextResponse.json(
      {
        code: "uid_mismatch",
        message: "firebase_uid does not match the authenticated subject",
      },
      { status: 403 }
    );
  }

  const supabase = getServiceRoleClient();
  const email = auth.email ?? body.email;

  try {
    let user = await findProvisionableUser(supabase, auth);

    if (user) {
      const healed = await backfillFirebaseUid(supabase, user, auth.uid);
      if (healed instanceof NextResponse) return healed;

      if (user.company_id) {
        return provisionedResponse(user.company_id, user.id, user.role);
      }
    } else {
      const created = await createUserRow(supabase, auth, body, email);
      if (created instanceof NextResponse) return created;
      user = created;
    }

    return await provisionCompany(supabase, auth, body, email, user);
  } catch (error) {
    console.error("[decks/provision-company] provisioning failed", error);
    return provisioningUnavailable();
  }
}

function provisionedResponse(
  companyId: string,
  userId: string,
  role: string | null
): NextResponse {
  // The Deckset app persists company_id verbatim and later routes compare it
  // against Postgres uuids, which render lowercase — normalize on the way out.
  return NextResponse.json({
    company_id: companyId.toLowerCase(),
    user_id: userId.toLowerCase(),
    role: role ?? "owner",
    subscription_plan: DECKS_SUBSCRIPTION_PLAN,
  });
}

function provisioningUnavailable(): NextResponse {
  return NextResponse.json(
    { code: "provisioning_failed", message: "Provisioning unavailable" },
    { status: 503 }
  );
}

async function readProvisionBody(
  req: NextRequest
): Promise<z.infer<typeof provisionBodySchema> | NextResponse> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { code: "bad_request", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = provisionBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "bad_request",
        message: "firebase_uid, email, and source_app are required.",
      },
      { status: 400 }
    );
  }

  return parsed.data;
}

const USER_LOOKUP_COLUMNS = "id, company_id, role, firebase_uid";

async function lookupUserBy(
  supabase: ServiceClient,
  column: "auth_id" | "firebase_uid" | "email",
  value: string
): Promise<ProvisionedUserRow | null> {
  const { data } = await supabase
    .from("users")
    .select(USER_LOOKUP_COLUMNS)
    .eq(column, value)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as ProvisionedUserRow | null) ?? null;
}

/**
 * auth_id → firebase_uid → email, mirroring findUserByAuth EXCEPT that the
 * email arm requires the identity provider to attest the address
 * (email_verified). Provisioning WRITES identity linkage off this match; an
 * unverified email is attacker-chosen, and honoring it would hand a legacy
 * account (and its company) to whoever registers the address in Firebase.
 * Unverified callers safely land in a fresh company-of-one instead.
 */
async function findProvisionableUser(
  supabase: ServiceClient,
  auth: DecksVerifiedAuth
): Promise<ProvisionedUserRow | null> {
  const byAuthId = await lookupUserBy(supabase, "auth_id", auth.uid);
  if (byAuthId) return byAuthId;

  const byFirebaseUid = await lookupUserBy(supabase, "firebase_uid", auth.uid);
  if (byFirebaseUid) return byFirebaseUid;

  if (auth.email && auth.emailVerified) {
    return lookupUserBy(supabase, "email", auth.email);
  }

  return null;
}

/**
 * deck_subscriptions RLS resolves the company scope through users.auth_id OR
 * users.firebase_uid against the JWT sub, so a row matched by email must get
 * firebase_uid backfilled or paid Pro stays locked. Fill-only: a row that
 * already carries a DIFFERENT firebase_uid is never overwritten (the sub may
 * be a Supabase auth UUID matched via auth_id, or the row may belong to a
 * rotated Firebase account — both are states to surface, not clobber).
 */
async function backfillFirebaseUid(
  supabase: ServiceClient,
  user: ProvisionedUserRow,
  uid: string
): Promise<void | NextResponse> {
  if (user.firebase_uid === uid) return;

  if (user.firebase_uid) {
    console.warn(
      `[decks/provision-company] user ${user.id} carries firebase_uid ${user.firebase_uid}, token sub is ${uid} — leaving linkage untouched`
    );
    return;
  }

  const { error } = await supabase
    .from("users")
    .update({ firebase_uid: uid })
    .eq("id", user.id);

  if (error) {
    console.error(
      `[decks/provision-company] firebase_uid backfill failed for ${user.id}:`,
      error.message
    );
    return provisioningUnavailable();
  }
  user.firebase_uid = uid;
}

function deriveNames(
  displayName: string | null | undefined,
  email: string
): { firstName: string; lastName: string; companyName: string } {
  const trimmed = displayName?.trim() ?? "";
  const firstName = trimmed.split(" ")[0] ?? "";
  const lastName = trimmed.split(" ").slice(1).join(" ");
  const companyName = trimmed || email.split("@")[0] || "Deckset operator";
  return { firstName, lastName, companyName };
}

async function createUserRow(
  supabase: ServiceClient,
  auth: DecksVerifiedAuth,
  body: z.infer<typeof provisionBodySchema>,
  email: string
): Promise<ProvisionedUserRow | NextResponse> {
  const { firstName, lastName } = deriveNames(body.display_name, email);

  const { data, error } = await supabase
    .from("users")
    .insert({
      email,
      first_name: firstName,
      last_name: lastName,
      firebase_uid: auth.uid,
    })
    .select("id")
    .single();

  if (!error && data) {
    return {
      id: data.id as string,
      company_id: null,
      role: null,
      firebase_uid: auth.uid,
    };
  }

  // 23505 on uq_users_firebase_uid: a concurrent provisioning call won the
  // insert. Converge on the winner row.
  if ((error as { code?: string } | null)?.code === "23505") {
    const winner = await lookupUserBy(supabase, "firebase_uid", auth.uid);
    if (winner) return winner;
  }

  console.error(
    "[decks/provision-company] users insert failed:",
    error?.message ?? "no row returned"
  );
  return provisioningUnavailable();
}

async function provisionCompany(
  supabase: ServiceClient,
  auth: DecksVerifiedAuth,
  body: z.infer<typeof provisionBodySchema>,
  email: string,
  user: ProvisionedUserRow
): Promise<NextResponse> {
  const { companyName } = deriveNames(body.display_name, email);

  const { data, error } = await supabase.rpc("provision_deck_company", {
    p_firebase_uid: auth.uid,
    p_company_name: companyName,
    p_email: email,
  });

  if (error) {
    // The wrapped create_company_for_owner raises ALREADY_IN_COMPANY (P0003)
    // when the caller joined a live company between our lookup and the RPC's
    // advisory-locked re-read. That company is the answer — fetch and return.
    const raced =
      error.message?.includes("ALREADY_IN_COMPANY") ||
      (error as { code?: string }).code === "P0003";
    if (raced) {
      const joined = await lookupUserBy(supabase, "firebase_uid", auth.uid);
      if (joined?.company_id) {
        return provisionedResponse(
          joined.company_id,
          joined.id,
          joined.role
        );
      }
    }

    console.error(
      "[decks/provision-company] provision_deck_company failed:",
      error.message
    );
    return provisioningUnavailable();
  }

  const result = data as {
    company_id?: string;
    user_id?: string;
    role?: string | null;
  } | null;

  if (!result?.company_id) {
    console.error(
      "[decks/provision-company] provision_deck_company returned no company_id"
    );
    return provisioningUnavailable();
  }

  return provisionedResponse(
    result.company_id,
    result.user_id ?? user.id,
    result.role ?? null
  );
}
