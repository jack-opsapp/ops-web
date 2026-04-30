/**
 * Dev-only auth bypass — mint Firebase custom token for a hardcoded test user.
 *
 * Why this exists: the Claude Code preview sandbox blocks navigation to
 * auth.opsapp.co, so the normal Google OAuth popup can't complete. This
 * route mints a custom token the client signs in with via
 * signInWithCustomToken — no popup, no redirect.
 *
 * User switching: reads a `dev-bypass-user` cookie and looks the key up in
 * a server-side allow-list. Cookie is a hint, not a credential — only
 * email values hardcoded here can be used.
 *
 * Production safety: 404 unless NODE_ENV === "development" AND
 * DEV_BYPASS_AUTH === "true". Email is a server-side constant.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebase/admin-sdk";

const BYPASS_USER_COOKIE = "dev-bypass-user";

/**
 * Allow-list of dev bypass identities — Maverick Projects test team,
 * ordered by privilege (owner first) for role-permission smoke testing.
 */
const BYPASS_USERS = {
  pete: { email: "peterjmitchell1988@gmail.com", label: "PETE" },
  tom: { email: "tkazansky1987@outlook.com", label: "TOM" },
  mike: { email: "vipermike1974@outlook.com", label: "MIKE" },
  nick: { email: "nickybradshaw1989@outlook.com", label: "NICK" },
} as const;

export type BypassUserKey = keyof typeof BYPASS_USERS;

const DEFAULT_USER: BypassUserKey = "pete";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.DEV_BYPASS_AUTH === "true"
  );
}

function resolveUser(cookieValue: string | undefined): BypassUserKey {
  if (cookieValue && cookieValue in BYPASS_USERS) {
    return cookieValue as BypassUserKey;
  }
  return DEFAULT_USER;
}

export async function POST() {
  if (!isEnabled()) return new NextResponse(null, { status: 404 });

  const cookieStore = await cookies();
  const key = resolveUser(cookieStore.get(BYPASS_USER_COOKIE)?.value);
  const { email, label } = BYPASS_USERS[key];

  try {
    const auth = getAdminAuth();
    const user = await auth.getUserByEmail(email);
    const token = await auth.createCustomToken(user.uid);
    return NextResponse.json({ token, email, key, label });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[dev-bypass] Failed to mint token for ${key}:`, message);
    return NextResponse.json(
      {
        error:
          "Failed to mint bypass token. Verify FIREBASE_ADMIN_PRIVATE_KEY / FIREBASE_ADMIN_CLIENT_EMAIL are set in .env.local.",
        detail: message,
      },
      { status: 500 }
    );
  }
}

// GET returns the active user metadata WITHOUT minting a token — used by
// the banner to render the active label without doing the full sign-in flow.
export async function GET() {
  if (!isEnabled()) return new NextResponse(null, { status: 404 });
  const cookieStore = await cookies();
  const key = resolveUser(cookieStore.get(BYPASS_USER_COOKIE)?.value);
  const { email, label } = BYPASS_USERS[key];
  return NextResponse.json({
    key,
    email,
    label,
    available: Object.entries(BYPASS_USERS).map(([k, v]) => ({
      key: k,
      label: v.label,
      email: v.email,
    })),
  });
}
