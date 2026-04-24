import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that authenticated users should be redirected away from
const authRoutes = ["/login", "/register"];

// Dashboard routes that require authentication
const protectedPrefixes = [
  "/dashboard",
  "/projects",
  "/calendar",
  "/clients",

  "/team",
  "/map",
  "/pipeline",
  "/calibration",
  "/estimates",
  "/products",
  "/inventory",
  "/invoices",
  "/accounting",
  "/deck-builder",
  "/settings",
  "/admin",
  "/testing-grounds",
  "/setup",
  "/employee-setup",
];

// Portal routes that require a portal session cookie
const portalProtectedPrefixes = [
  "/portal/home",
  "/portal/projects",
  "/portal/estimates",
  "/portal/invoices",
  "/portal/messages",
];

// Portal routes that are publicly accessible (no session needed)
const portalPublicPrefixes = ["/portal/verify", "/portal/auth"];

/**
 * CALIBRATION 308 redirects from retired AI surfaces. Exact-match only —
 * keeps sub-routes of /settings / /agent intact while the legacy hub
 * pages hard-redirect.
 */
const CALIBRATION_REDIRECTS: Record<string, string> = {
  "/settings/integrations/ai-setup": "/calibration",
  "/agent/comms-config": "/calibration?section=config&wizard=open",
  "/intel": "/calibration?section=corpus",
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── CALIBRATION retirements (308 permanent) ────────────────────────────
  if (CALIBRATION_REDIRECTS[pathname] !== undefined) {
    const target = CALIBRATION_REDIRECTS[pathname];
    const [basePath, query] = target.split("?");
    const url = request.nextUrl.clone();
    url.pathname = basePath;
    url.search = query ? `?${query}` : "";
    return NextResponse.redirect(url, 308);
  }

  // ─── Portal Routes ───────────────────────────────────────────────────────
  if (pathname.startsWith("/portal")) {
    // Public portal pages (verification flow)
    if (portalPublicPrefixes.some((p) => pathname.startsWith(p))) {
      return NextResponse.next();
    }

    // Magic link landing pages: /portal/[64-char-hex-token]
    if (/^\/portal\/[a-f0-9]{64}$/.test(pathname)) {
      return NextResponse.next();
    }

    // Protected portal pages: require ops-portal-session cookie
    const portalSession = request.cookies.get("ops-portal-session")?.value;
    if (
      !portalSession &&
      portalProtectedPrefixes.some((p) => pathname.startsWith(p))
    ) {
      return NextResponse.redirect(new URL("/portal/verify", request.url));
    }

    return NextResponse.next();
  }

  // ─── Dashboard Routes ────────────────────────────────────────────────────

  // Check for auth token in cookies
  // Firebase sets a session cookie; we also check for a custom token cookie
  // that can be set client-side after Firebase auth
  const authToken =
    request.cookies.get("__session")?.value ||
    request.cookies.get("ops-auth-token")?.value;

  const isAuthenticated = !!authToken;

  // If user is on an auth route and is authenticated, redirect to destination
  if (authRoutes.some((route) => pathname === route)) {
    if (isAuthenticated) {
      const redirect = request.nextUrl.searchParams.get("redirect") || "/dashboard";
      return NextResponse.redirect(new URL(redirect, request.url));
    }
    return NextResponse.next();
  }

  // If user is on a protected route and NOT authenticated, redirect to login
  const isProtected = protectedPrefixes.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    // Preserve the intended destination for post-login redirect
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Public routes and onboarding - allow through
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public files (fonts, images, etc.)
     * - API routes
     */
    "/((?!_next/static|_next/image|favicon\\.ico|fonts|images|api).*)",
  ],
};
