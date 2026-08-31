/**
 * POST /api/setup/progress
 *
 * Incrementally saves setup progress for each onboarding step.
 * - Verifies Firebase/Supabase auth token
 * - Persists step-specific data (identity, company, starfield)
 * - Company creation goes through the `create_company_for_owner_by_id` RPC so
 *   the company, its join code, the Owner role row, the owner labels, and the
 *   company defaults all land in ONE transaction (or none of them do)
 * - Tracks which steps have been completed via setup_progress JSONB
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { readServerFirstTouch } from "@/lib/pmf/utm-capture";
import { recordTrialAttribution } from "@/lib/pmf/trial-attribution";
import { isReferralSourceSlug } from "@/lib/data/referral-sources";

// ─── Request Body ────────────────────────────────────────────────────────────

interface ProgressBody {
  token: string;
  step: "identity" | "company" | "starfield";
  data?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    companyName?: string;
    industries?: string[];
    companySize?: string;
    companyAge?: string;
    weatherDependent?: string;
    referralMethod?: string;
    starfieldAnswers?: Record<string, string | number>;
  };
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface SetupProgress {
  steps?: Record<string, boolean>;
  starfield_answers?: Record<string, string | number>;
}

/** Return contract of public.create_company_for_owner_by_id. */
interface CreateCompanyForOwnerResult {
  company_id: string;
  company_code: string;
  already_existed: boolean;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as ProgressBody;
    const { token, step, data } = body;

    // Validate required fields
    if (!token || !step) {
      return NextResponse.json(
        { error: "Missing required fields: token, step" },
        { status: 400 }
      );
    }

    const validSteps = ["identity", "company", "starfield"];
    if (!validSteps.includes(step)) {
      return NextResponse.json(
        {
          error: `Invalid step: ${step}. Must be one of: ${validSteps.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Verify auth token
    const verifiedUser = await verifyAuthToken(token);

    const db = getServiceRoleClient();

    // Find the user by auth credentials (auth_id → firebase_uid → email)
    const userRow = await findUserByAuth(
      verifiedUser.uid,
      verifiedUser.email,
      "*"
    );

    if (!userRow) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userId = userRow.id as string;

    // Read current setup_progress (JSONB, defaults to {})
    const currentProgress: SetupProgress =
      (userRow.setup_progress as SetupProgress) ?? {};

    // Merge step completion
    const updatedProgress: SetupProgress = {
      ...currentProgress,
      steps: { ...currentProgress.steps, [step]: true },
    };

    // ── Handle step-specific data ──

    if (step === "identity" && data) {
      const identityUpdates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (data.firstName) identityUpdates.first_name = data.firstName;
      if (data.lastName) identityUpdates.last_name = data.lastName;
      if (data.phone) identityUpdates.phone = data.phone;

      await db.from("users").update(identityUpdates).eq("id", userId);
    }

    if (step === "company" && data) {
      let companyId = userRow.company_id as string | null;

      if (companyId) {
        // User already has a company -- update it
        const companyUpdates: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        if (data.companyName) companyUpdates.name = data.companyName;
        if (data.industries?.length)
          companyUpdates.industries = data.industries;
        if (data.companySize) companyUpdates.company_size = data.companySize;
        if (data.companyAge) companyUpdates.company_age = data.companyAge;
        if (data.weatherDependent)
          companyUpdates.weather_dependent = data.weatherDependent === "Yes";
        // Validated against the known slug set — a raw client string must
        // never reach the column.
        if (isReferralSourceSlug(data.referralMethod)) {
          companyUpdates.referral_method = data.referralMethod;
        }

        await db.from("companies").update(companyUpdates).eq("id", companyId);
      } else {
        // One transaction: company row + crew join code + Owner `user_roles`
        // row + owner labels + `initialize_company_defaults`.
        //
        // This replaces four separate autocommit statements. If the role write
        // or the user link failed, the company was already committed while the
        // user stayed unlinked — and the retry re-entered this same branch and
        // minted a SECOND company, orphaning the first. One production account
        // holder accumulated five orphan companies in 33 seconds that way and
        // never got into the product at all.
        //
        // The RPC also ADOPTS an existing unlinked company held by this owner
        // rather than inserting another, so a retry after any partial failure
        // completes the orphan instead of duplicating it.
        //
        // `create_company_for_owner` (the iOS/authenticated twin) cannot be
        // reused here: it resolves its caller via `auth.jwt() ->> 'sub'` and
        // raises NO_JWT under the service-role client this route uses. This is
        // its service-role twin — the owner is named explicitly, which is why
        // EXECUTE on it is granted to service_role alone.
        const { data: createResult, error: createError } = await db.rpc(
          "create_company_for_owner_by_id",
          {
            p_user_id: userId,
            p_name: data.companyName?.trim() || "Untitled Company",
            p_industries: data.industries?.length ? data.industries : [],
            p_company_size: data.companySize ?? null,
            p_company_age: data.companyAge ?? null,
            p_weather_dependent: data.weatherDependent
              ? data.weatherDependent === "Yes"
              : null,
            // Validated against the known slug set — a raw client string must
            // never reach the column.
            p_referral_method: isReferralSourceSlug(data.referralMethod)
              ? data.referralMethod
              : null,
          }
        );

        if (createError) {
          const message = createError.message ?? "";
          // Typed tokens raised by the RPC. NO_USER_ROW is the sync-user race
          // and ALREADY_IN_COMPANY a stale read — both are retryable by the
          // client, so they must not read as server faults.
          const status =
            message.includes("NO_USER_ROW") ||
            message.includes("ALREADY_IN_COMPANY")
              ? 409
              : message.includes("INVALID_NAME")
                ? 400
                : message.includes("USER_INACTIVE")
                  ? 403
                  : 500;
          return NextResponse.json(
            {
              error: `Failed to create company: ${message || "Unknown error"}`,
            },
            { status }
          );
        }

        const created = createResult as CreateCompanyForOwnerResult | null;
        if (!created?.company_id) {
          return NextResponse.json(
            { error: "Failed to create company: no company id returned." },
            { status: 500 }
          );
        }

        companyId = created.company_id;

        // Day 0 founder welcome — fire-and-forget after company creation.
        // Per spec §3 + decision log #25/#26: only fire when the inserting
        // user IS the new company's account_holder (always true here: the RPC
        // sets `account_holder_id` to this user, and only ever adopts a
        // company already held by them) and
        // when the operator email isn't on the internal allowlist.
        // Failure does NOT roll back signup; cron will retry up to 3 times
        // within day_slot_expires_at if the async fails.
        const operatorEmail =
          (userRow.email as string | null | undefined) ?? null;
        const INTERNAL_DOMAINS = ["@opsapp.co", "@anthropic.com"];
        const isInternal = operatorEmail
          ? INTERNAL_DOMAINS.some((d) =>
              operatorEmail.toLowerCase().endsWith(d)
            )
          : true;

        if (!isInternal && operatorEmail) {
          void (async () => {
            try {
              const expires = new Date(
                Date.now() + 24 * 60 * 60_000
              ).toISOString();
              const { data: logRow, error: insertError } = await db
                .from("onboarding_email_log")
                .insert({
                  user_id: userId,
                  company_id: companyId,
                  day_slot: "day_0",
                  branch: null,
                  email_type: "onboarding_day_0_welcome",
                  status: "pending",
                  attempts: 0,
                  day_slot_expires_at: expires,
                })
                .select("id")
                .single();

              if (insertError || !logRow) {
                // Unique-violation = sibling already claimed; not an error.
                if (insertError && insertError.code !== "23505") {
                  console.error(
                    "[onboarding-day0] claim INSERT failed:",
                    insertError
                  );
                }
                return;
              }

              const { sendOnboardingDay0Welcome } =
                await import("@/lib/email/sendgrid");
              const result = await sendOnboardingDay0Welcome({
                email: operatorEmail,
                firstName:
                  (userRow.first_name as string | null | undefined) ?? null,
                onboardingEmailLogId: logRow.id as string,
                userId,
              });

              const update: Record<string, unknown> =
                result.status === "sent"
                  ? {
                      status: "sent",
                      sent_at: new Date().toISOString(),
                      sg_message_id: result.messageId,
                    }
                  : result.status === "suppression_skipped"
                    ? { status: "skipped" }
                    : { status: "pending" };
              await db
                .from("onboarding_email_log")
                .update(update)
                .eq("id", logRow.id);
            } catch (err) {
              console.error("[onboarding-day0] async dispatch failed:", err);
            }
          })();
        }
      }

      // Attribution capture (Unified Attribution P2).
      //
      // The trial_attributions row already exists — companies_seed_trial_attribution
      // creates one for EVERY company the moment it is inserted, on every
      // platform. This upgrades that row with the real first-touch payload.
      //
      // Read server-side from the request's Cookie header rather than a client
      // body field: the allowlisted cookie travels with the request and is
      // validated again by the database RPC. Runs for both branches above
      // (new company and resumed setup) and never blocks company creation.
      if (companyId) {
        await recordTrialAttribution(
          db,
          companyId,
          readServerFirstTouch(req.headers.get("cookie"))
        );
      }
    }

    if (step === "starfield" && data?.starfieldAnswers) {
      updatedProgress.starfield_answers = {
        ...currentProgress.starfield_answers,
        ...data.starfieldAnswers,
      };
    }

    // Write updated setup_progress back to users table
    await db
      .from("users")
      .update({
        setup_progress: updatedProgress,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    return NextResponse.json({
      success: true,
      setupProgress: updatedProgress,
    });
  } catch (error) {
    console.error("[api/setup/progress] Error:", error);

    if (error instanceof Error && error.message.includes("Token")) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
