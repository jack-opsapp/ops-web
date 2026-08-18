/**
 * POST /api/setup/progress
 *
 * Incrementally saves setup progress for each onboarding step.
 * - Verifies Firebase/Supabase auth token
 * - Persists step-specific data (identity, company, starfield)
 * - Tracks which steps have been completed via setup_progress JSONB
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { findUserByAuth } from "@/lib/supabase/find-user-by-auth";
import { readServerFirstTouch } from "@/lib/pmf/utm-capture";
import { recordTrialAttribution } from "@/lib/pmf/record-trial-attribution";
import { isReferralSourceSlug } from "@/lib/data/referral-sources";
import {
  COMPANY_CODE_MAX_ATTEMPTS,
  generateCompanyCode,
  isCompanyCodeCollision,
} from "@/lib/data/company-code";
import { PRESET_ROLE_IDS } from "@/lib/types/permissions";

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
        { error: `Invalid step: ${step}. Must be one of: ${validSteps.join(", ")}` },
        { status: 400 }
      );
    }

    // Verify auth token
    const verifiedUser = await verifyAuthToken(token);

    const db = getServiceRoleClient();

    // Find the user by auth credentials (auth_id → firebase_uid → email)
    const userRow = await findUserByAuth(verifiedUser.uid, verifiedUser.email, "*");

    if (!userRow) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
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
        if (data.industries?.length) companyUpdates.industries = data.industries;
        if (data.companySize) companyUpdates.company_size = data.companySize;
        if (data.companyAge) companyUpdates.company_age = data.companyAge;
        if (data.weatherDependent) companyUpdates.weather_dependent = data.weatherDependent === "Yes";
        // Validated against the known slug set — a raw client string must
        // never reach the column.
        if (isReferralSourceSlug(data.referralMethod)) {
          companyUpdates.referral_method = data.referralMethod;
        }

        await db.from("companies").update(companyUpdates).eq("id", companyId);
      } else {
        // Create new company. The crew join code is minted as part of the insert
        // so a company never exists without one — the same property the iOS RPC
        // `create_company_for_owner` guarantees. Without a code the owner's crew
        // has no way to join.
        const companyPayload = {
          name: data.companyName ?? "Untitled Company",
          industries: data.industries?.length ? data.industries : [],
          company_size: data.companySize ?? null,
          company_age: data.companyAge ?? null,
          weather_dependent: data.weatherDependent ? data.weatherDependent === "Yes" : null,
          referral_method: isReferralSourceSlug(data.referralMethod)
            ? data.referralMethod
            : null,
          admin_ids: [userId],
          account_holder_id: userId,
        };

        let newCompany: { id: string } | null = null;
        let companyError: {
          message?: string | null;
          code?: string | null;
          details?: string | null;
        } | null = null;

        for (let attempt = 0; attempt < COMPANY_CODE_MAX_ATTEMPTS; attempt += 1) {
          const { data: inserted, error } = await db
            .from("companies")
            .insert({ ...companyPayload, company_code: generateCompanyCode() })
            .select("id")
            .single();

          if (!error && inserted) {
            newCompany = inserted as { id: string };
            companyError = null;
            break;
          }

          companyError = error;
          // Only a collision on the company-code index is retryable; every other
          // failure is terminal and must not be masked by 20 more attempts.
          if (!isCompanyCodeCollision(error)) break;
        }

        if (companyError || !newCompany) {
          return NextResponse.json(
            {
              error: `Failed to create company: ${companyError?.message ?? "Unknown error"}`,
            },
            { status: 500 }
          );
        }

        companyId = newCompany.id as string;

        // Seed default task types, inventory units, and company settings
        const { error: rpcError } = await db.rpc("initialize_company_defaults", {
          p_company_id: companyId,
        });
        if (rpcError) {
          console.error("[api/setup/progress] Failed to initialize company defaults:", rpcError);
        }

        // Seed the Owner role row BEFORE linking the user to the company.
        //
        // ORDER IS LOAD-BEARING. The constraint trigger
        // `private.guard_user_roles_final_state()` rejects any direct user_roles
        // write whose target is already a company admin (`target_is_admin`,
        // SQLSTATE 42501). It tests admin-ness through
        // `private.permission_user_is_admin(u.id, u.company_id)`, which compares
        // `u.company_id = p_company_id` — while company_id is still NULL that
        // comparison is NULL, so the user reads as a non-admin and the write is
        // legal. The update below is precisely what makes them an admin, so this
        // row can never be written after it. (The iOS RPC reaches the same state
        // from the other side: it clears company_id and forces the trigger
        // IMMEDIATE around its own insert.)
        const { error: roleError } = await db.from("user_roles").upsert(
          { user_id: userId, role_id: PRESET_ROLE_IDS.OWNER },
          { onConflict: "user_id" }
        );
        if (roleError) {
          // Fatal, deliberately. A swallowed failure here is exactly what left
          // five production account holders with no role row and no permissions.
          return NextResponse.json(
            { error: `Failed to assign owner role: ${roleError.message}` },
            { status: 500 }
          );
        }

        // Link user to company and set the denormalized owner labels the rest of
        // the product reads (`role`, `user_type`).
        const { error: linkError } = await db
          .from("users")
          .update({
            company_id: companyId,
            is_company_admin: true,
            role: "owner",
            user_type: "company",
          })
          .eq("id", userId);
        if (linkError) {
          return NextResponse.json(
            { error: `Failed to link user to company: ${linkError.message}` },
            { status: 500 }
          );
        }

        // Day 0 founder welcome — fire-and-forget after company creation.
        // Per spec §3 + decision log #25/#26: only fire when the inserting
        // user IS the new company's account_holder (which is always true here
        // because we set `account_holder_id: userId` on the INSERT above) and
        // when the operator email isn't on the internal allowlist.
        // Failure does NOT roll back signup; cron will retry up to 3 times
        // within day_slot_expires_at if the async fails.
        const operatorEmail = (userRow.email as string | null | undefined) ?? null;
        const INTERNAL_DOMAINS = ["@opsapp.co", "@anthropic.com"];
        const isInternal =
          operatorEmail
            ? INTERNAL_DOMAINS.some((d) => operatorEmail.toLowerCase().endsWith(d))
            : true;

        if (!isInternal && operatorEmail) {
          void (async () => {
            try {
              const expires = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
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
                  console.error("[onboarding-day0] claim INSERT failed:", insertError);
                }
                return;
              }

              const { sendOnboardingDay0Welcome } = await import("@/lib/email/sendgrid");
              const result = await sendOnboardingDay0Welcome({
                email: operatorEmail,
                firstName: (userRow.first_name as string | null | undefined) ?? null,
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
              await db.from("onboarding_email_log").update(update).eq("id", logRow.id);
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
      // body field: the value is already travelling with the request, so there
      // is nothing extra to send and nothing to forge independently of the
      // cookie itself. Runs for both branches above (new company and resumed
      // setup) and never throws.
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
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
