import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { verifyFirebaseToken } from "@/lib/firebase/admin-verify";

export async function GET() {
  const cookieStore = await cookies();
  const headersList = await headers();

  const token =
    headersList.get("authorization")?.replace("Bearer ", "") ||
    cookieStore.get("__session")?.value ||
    cookieStore.get("ops-auth-token")?.value;

  if (!token) {
    return NextResponse.json({ error: "no token found", cookies: {
      __session: !!cookieStore.get("__session"),
      "ops-auth-token": !!cookieStore.get("ops-auth-token"),
    }});
  }

  try {
    const user = await verifyFirebaseToken(token);
    return NextResponse.json({
      success: true,
      uid: user.uid,
      email: user.email,
      emailMatch: user.email === "jack@opsapp.co",
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  } catch (err: unknown) {
    return NextResponse.json({
      error: "verification failed",
      message: err instanceof Error ? err.message : String(err),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      tokenLength: token.length,
    });
  }
}
