import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/firebase/admin-verify";

export async function GET() {
  const cookieStore = await cookies();
  const headersList = await headers();
  const results: Record<string, unknown> = {};

  // 1. Check auth token
  const token =
    headersList.get("authorization")?.replace("Bearer ", "") ||
    cookieStore.get("__session")?.value ||
    cookieStore.get("ops-auth-token")?.value;

  results.tokenPresent = !!token;
  results.tokenLength = token?.length ?? 0;

  if (token) {
    try {
      const user = await verifyFirebaseToken(token);
      results.auth = { success: true, uid: user.uid, email: user.email };
    } catch (err: unknown) {
      results.auth = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  // 2. Check env vars + inspect private key format
  const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "";
  results.envVars = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    FIREBASE_ADMIN_PRIVATE_KEY: !!process.env.FIREBASE_ADMIN_PRIVATE_KEY,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "MISSING",
    FIREBASE_ADMIN_CLIENT_EMAIL: !!process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    GA4_PROPERTY_ID: !!process.env.GA4_PROPERTY_ID,
  };
  results.privateKeyDebug = {
    length: rawKey.length,
    first50: rawKey.slice(0, 50),
    last30: rawKey.slice(-30),
    hasBeginMarker: rawKey.includes("-----BEGIN"),
    hasEndMarker: rawKey.includes("-----END"),
    hasLiteralBackslashN: rawKey.includes("\\n"),
    hasRealNewlines: rawKey.includes("\n"),
    startsWithQuote: rawKey.startsWith('"'),
  };

  // 3. Test Supabase
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
    results.supabase = { error: err instanceof Error ? err.message : String(err) };
  }

  // 4. Test Firebase Admin SDK
  try {
    const { listAllAuthUsers } = await import("@/lib/firebase/admin-sdk");
    const users = await listAllAuthUsers();
    results.firebaseAdmin = { success: true, userCount: users.length };
  } catch (err: unknown) {
    results.firebaseAdmin = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json(results);
}
