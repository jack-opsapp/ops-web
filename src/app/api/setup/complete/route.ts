/**
 * POST /api/setup/complete
 *
 * Saves identity + company info collected during setup.
 * - Verifies Firebase/Supabase auth token
 * - Updates user record (first_name, last_name, phone)
 * - Creates or updates company record (name, industries, company_size, company_age)
 * - Links user to company (sets company_id on user, adds user to admin_ids)
 * - Returns updated user + company
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

// ─── Request Body ────────────────────────────────────────────────────────────

interface SetupCompleteBody {
  token: string;
  firstName: string;
  lastName: string;
  phone?: string;
  companyName: string;
  industry: string;
  companySize: string;
  companyAge: string;
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as SetupCompleteBody;
    const {
      token,
      firstName,
      lastName,
      phone,
      companyName,
      industry,
      companySize,
      companyAge,
    } = body;

    if (!token || !companyName) {
      return NextResponse.json(
        { error: "Missing required fields: token, companyName" },
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

    // ── Update user record ──
    const userUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      has_completed_onboarding: true,
    };
    if (firstName) userUpdates.first_name = firstName;
    if (lastName) userUpdates.last_name = lastName;
    if (phone) userUpdates.phone = phone;

    await db.from("users").update(userUpdates).eq("id", userId);

    // ── Create or update company ──
    let companyId = userRow.company_id as string | null;

    if (companyId) {
      // User already has a company — update it
      const companyUpdates: Record<string, unknown> = {
        name: companyName,
        industries: [industry],
        company_size: companySize,
        company_age: companyAge,
        updated_at: new Date().toISOString(),
      };

      await db.from("companies").update(companyUpdates).eq("id", companyId);
    } else {
      // Create new company
      const { data: newCompany, error: companyError } = await db
        .from("companies")
        .insert({
          name: companyName,
          industries: [industry],
          company_size: companySize,
          company_age: companyAge,
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

      // Link user to company
      await db
        .from("users")
        .update({
          company_id: companyId,
          is_company_admin: true,
        })
        .eq("id", userId);
    }

    return NextResponse.json({ success: true, userId, companyId });
  } catch (error) {
    console.error("[api/setup/complete] Error:", error);

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
