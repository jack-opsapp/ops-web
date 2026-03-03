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
    const authUid = verifiedUser.uid;

    const db = getServiceRoleClient();

    // Find the user by auth_id
    const { data: userRow, error: userLookupError } = await db
      .from("users")
      .select("*")
      .eq("auth_id", authUid)
      .is("deleted_at", null)
      .maybeSingle();

    if (userLookupError || !userRow) {
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

        await db.from("companies").update(companyUpdates).eq("id", companyId);
      } else {
        // Create new company
        const { data: newCompany, error: companyError } = await db
          .from("companies")
          .insert({
            name: data.companyName ?? "Untitled Company",
            industries: data.industries?.length ? data.industries : [],
            company_size: data.companySize ?? null,
            company_age: data.companyAge ?? null,
            admin_ids: [userId],
            account_holder_id: userId,
          })
          .select("id")
          .single();

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

        // Link user to company
        await db
          .from("users")
          .update({
            company_id: companyId,
            is_company_admin: true,
          })
          .eq("id", userId);
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
