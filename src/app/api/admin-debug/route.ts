import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";

export const GET = withAdmin(async (request: NextRequest) => {
  await requireAdmin(request);
  const results: Record<string, unknown> = {};

  // 1. Check configuration presence without returning credential material.
  results.envVars = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    FIREBASE_ADMIN_PRIVATE_KEY: !!process.env.FIREBASE_ADMIN_PRIVATE_KEY,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID:
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "MISSING",
    FIREBASE_ADMIN_CLIENT_EMAIL: !!process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    GA4_MARKETING_PROPERTY_ID: !!process.env.GA4_MARKETING_PROPERTY_ID,
    GA4_WEB_APP_PROPERTY_ID: !!process.env.GA4_WEB_APP_PROPERTY_ID,
    GA4_IOS_PROPERTY_ID: !!process.env.GA4_IOS_PROPERTY_ID,
    GA4_DEDICATED_SERVICE_ACCOUNT:
      !!process.env.GA4_SERVICE_ACCOUNT_JSON ||
      (!!process.env.GA4_SERVICE_ACCOUNT_CLIENT_EMAIL &&
        !!process.env.GA4_SERVICE_ACCOUNT_PRIVATE_KEY),
  };

  // 2. Test Supabase
  try {
    const { getAdminSupabase } = await import("@/lib/supabase/admin-client");
    const db = getAdminSupabase();
    const { count, error } = await db
      .from("companies")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null);
    results.supabase = error
      ? { error: error.message, code: error.code }
      : { success: true, companyCount: count };
  } catch (err: unknown) {
    results.supabase = {
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 3. Test Firebase Admin SDK
  try {
    const { listAllAuthUsers } = await import("@/lib/firebase/admin-sdk");
    const users = await listAllAuthUsers();
    results.firebaseAdmin = { success: true, userCount: users.length };
  } catch (err: unknown) {
    results.firebaseAdmin = {
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return NextResponse.json(results);
});
