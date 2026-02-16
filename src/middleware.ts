import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that don't require authentication
const publicRoutes = ["/login", "/register", "/pin", "/locked"];

// Routes that authenticated users should be redirected away from
const authRoutes = ["/login", "/register"];

// Dashboard routes that require authentication
const protectedPrefixes = [
  "/dashboard",
  "/projects",
  "/calendar",
  "/clients",
  "/job-board",
  "/team",
  "/map",
  "/pipeline",
  "/invoices",
  "/accounting",
  "/settings",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check for auth token in cookies
  // Firebase sets a session cookie; we also check for a custom token cookie
  // that can be set client-side after Firebase auth
  const authToken =
    request.cookies.get("__session")?.value ||
    request.cookies.get("ops-auth-token")?.value;

  const isAuthenticated = !!authToken;

  // If user is on an auth route and is authenticated, redirect to projects
  if (authRoutes.some((route) => pathname === route)) {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL("/projects", request.url));
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
