import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_RETURN_TO_HEADER,
  getFirebaseIdTokenCookieMaxAge,
  LEGACY_SESSION_COOKIE_NAME,
  OPS_AUTH_COOKIE_NAME,
  selectFirebaseIdTokenCookie,
} from "@/lib/auth/firebase-id-token-cookie";

// Routes that authenticated users should be redirected away from
const authRoutes = ["/login", "/register"];

// Dashboard routes that require authentication
const protectedPrefixes = [
  "/dashboard",
  "/projects",
  "/schedule",
  "/clients",

  "/team",
  "/map",
  "/pipeline",
  "/calibration",
  "/books",
  "/catalog",
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

function clearAuthCookies(response: NextResponse, secure: boolean) {
  for (const name of [OPS_AUTH_COOKIE_NAME, LEGACY_SESSION_COOKIE_NAME]) {
    response.cookies.set({
      name,
      value: "",
      path: "/",
      maxAge: 0,
      sameSite: "lax",
      secure,
    });
  }
  return response;
}

/**
 * Hosted customer surface (design D3, I3, I9): `/c/<handle>/…` pages and the
 * `/api/customer/…` broker. Public at the middleware layer — no staff cookie
 * is required and none is read. Authority is resolved per request by the
 * route itself (session row + membership state), never here. The customer
 * session cookie (`ops-customer-session`) is never consulted by this
 * middleware on any path: a customer credential must never read as a staff
 * login, and a staff login must never read as a customer.
 *
 * Matching is exact-segment (`/c` or `/c/…`) so `/clients`, `/catalog` and
 * `/calibration` stay staff-protected.
 */
export const CUSTOMER_PUBLIC_PREFIXES = ["/c", "/api/customer"] as const;

function isCustomerPublicPath(pathname: string): boolean {
  return CUSTOMER_PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

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

  // Public v1 endpoints own bearer authentication at the route boundary.
  // Never let browser session cookies or dashboard redirect logic participate.
  if (pathname === "/v1" || pathname.startsWith("/v1/")) {
    return NextResponse.next();
  }

  // ─── CALIBRATION retirements (308 permanent) ────────────────────────────
  if (CALIBRATION_REDIRECTS[pathname] !== undefined) {
    const target = CALIBRATION_REDIRECTS[pathname];
    const [basePath, query] = target.split("?");
    const url = request.nextUrl.clone();
    url.pathname = basePath;
    url.search = query ? `?${query}` : "";
    return NextResponse.redirect(url, 308);
  }

  // ─── Calendar → Schedule rename (308 permanent, query-preserving) ────────
  // WEB OVERHAUL P2 (master plan §2): the surface is named Schedule
  // everywhere. Old notification action_urls (/calendar?date=…&task=…) must
  // keep resolving, so the search string carries through untouched. Covers
  // /calendar and any sub-path.
  if (pathname === "/calendar" || pathname.startsWith("/calendar/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/calendar/, "/schedule");
    return NextResponse.redirect(url, 308);
  }

  // ─── BOOKS absorption (P3.1) — 308 permanent, param-preserving ───────────
  // master plan §2 row 5: Estimates / Invoices / Accounting / the cashflow
  // placeholder collapse into /books. Stored notification action_urls
  // (/invoices, /accounting, iOS forecast_dip's /books/cashflow) and widget
  // deep links (?status=…, ?action=new) must keep resolving. Exact mapping:
  // docs/specs/2026-06-11-books-capability-inventory.md §6.
  if (pathname === "/estimates" || pathname === "/invoices") {
    const url = request.nextUrl.clone();
    url.pathname = "/books";
    url.searchParams.set(
      "segment",
      pathname === "/estimates" ? "estimates" : "invoices"
    );
    return NextResponse.redirect(url, 308);
  }
  if (pathname === "/accounting") {
    const url = request.nextUrl.clone();
    url.pathname = "/books";
    const tab = url.searchParams.get("tab");
    url.searchParams.delete("tab");
    if (tab === "expenses") {
      url.searchParams.set("segment", "expenses");
    } else if (tab === "integrations") {
      url.searchParams.set("segment", "sync");
    } else if (tab === "import") {
      url.searchParams.set("segment", "sync");
      url.searchParams.set("view", "import");
    } else {
      // Dashboard tab (or no tab) = the A/R view.
      url.searchParams.set("segment", "invoices");
      url.searchParams.set("view", "aging");
    }
    return NextResponse.redirect(url, 308);
  }
  if (pathname === "/money/cashflow" || pathname === "/books/cashflow") {
    const url = request.nextUrl.clone();
    url.pathname = "/books";
    return NextResponse.redirect(url, 308);
  }
  // Expenses live in Books now (segment=expenses). The FAB already targets
  // /books?segment=expenses, but stored notification action_urls (e.g.
  // use-expense-approval's "/expenses") must keep resolving — this catches them.
  if (pathname === "/expenses") {
    const url = request.nextUrl.clone();
    url.pathname = "/books";
    url.searchParams.set("segment", "expenses");
    return NextResponse.redirect(url, 308);
  }

  // ─── CATALOG absorption (P3.2) — 308 permanent, param-preserving ─────────
  // master plan §2 row 6: Products + Inventory collapse into /catalog with
  // PRODUCTS / STOCK segments. Stored notification action_urls (/inventory,
  // the FAB's /inventory?action=new) and the iOS "VIEW ON WEB →" deep link to
  // /products/{id} must keep resolving. Mapping:
  // docs/specs/2026-06-11-catalog-capability-inventory.md §4.
  if (pathname === "/products") {
    const url = request.nextUrl.clone();
    url.pathname = "/catalog";
    url.searchParams.set("segment", "products");
    return NextResponse.redirect(url, 308);
  }
  if (pathname.startsWith("/products/")) {
    // /products/{id} (iOS deep link) and /products/{id}/options → the full
    // product editor at /catalog/products/{id}.
    const id = pathname.slice("/products/".length).split("/")[0];
    const url = request.nextUrl.clone();
    url.pathname = id ? `/catalog/products/${id}` : "/catalog";
    if (!id) url.searchParams.set("segment", "products");
    return NextResponse.redirect(url, 308);
  }
  if (pathname === "/inventory") {
    const url = request.nextUrl.clone();
    url.pathname = "/catalog";
    url.searchParams.set("segment", "stock");
    // ?action=new (FAB / legacy deep link) carries through via the clone.
    return NextResponse.redirect(url, 308);
  }

  // ─── TEAM absorption (P3.4) — 308 permanent, param-preserving ────────────
  // master plan §2 row 8: Team (members, invites, roles, permissions) collapses
  // into Settings. Stored deep links (/team, /team?action=invite, the
  // role_needed / unseated-admin lockout action_urls) must keep resolving onto
  // SETTINGS › TEAM › Members. ?action=invite + ?assignRole carry through via
  // the clone — TeamSection reads both.
  if (pathname === "/team" || pathname.startsWith("/team/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/settings";
    url.searchParams.set("section", "team");
    return NextResponse.redirect(url, 308);
  }

  // ─── MAP absorption (P3.5) — 308 permanent, param-preserving ─────────────
  // master plan §2 row 2: the standalone Map collapses into Projects as a third
  // view mode. Stored notification action_urls / deep links to /map (and any
  // /map/* sub-path) must keep resolving onto the Projects MAP view. Any query
  // state carries through via the clone, then ?view=map selects the mode.
  if (pathname === "/map" || pathname.startsWith("/map/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/projects";
    url.searchParams.set("view", "map");
    return NextResponse.redirect(url, 308);
  }

  // ─── Hosted customer surface ─────────────────────────────────────────────
  // Before any cookie is read: these paths carry no staff identity and the
  // customer credential is the route's business, not the middleware's.
  if (isCustomerPublicPath(pathname)) {
    return NextResponse.next();
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

  // Token decoding here is only a routing hint. Actual authorization remains
  // the responsibility of server routes/layouts that cryptographically verify
  // the Firebase token and any required role or allowlist.
  const canonicalToken = request.cookies.get(OPS_AUTH_COOKIE_NAME)?.value;
  const legacyToken = request.cookies.get(LEGACY_SESSION_COOKIE_NAME)?.value;
  const authToken = selectFirebaseIdTokenCookie(canonicalToken, legacyToken);
  const isAuthenticated =
    authToken !== null && getFirebaseIdTokenCookieMaxAge(authToken) !== null;
  const secure = request.nextUrl.protocol === "https:";

  // Auth pages own the verified client-side redirect. Middleware must not send
  // someone away from login based solely on an unverified cookie.
  if (authRoutes.some((route) => pathname === route)) {
    const response = NextResponse.next();
    return authToken && !isAuthenticated
      ? clearAuthCookies(response, secure)
      : response;
  }

  // If user is on a protected route and NOT authenticated, redirect to login
  const isProtected = protectedPrefixes.some((prefix) =>
    pathname.startsWith(prefix)
  );

  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    // Preserve the full intended destination — path AND query — so a
    // client-seeded deep link (e.g. /projects/new?clientId=…) survives the
    // login bounce. `search` includes the leading "?" (or is "" when absent).
    loginUrl.searchParams.set("redirect", pathname + request.nextUrl.search);
    const response = NextResponse.redirect(loginUrl);
    return authToken ? clearAuthCookies(response, secure) : response;
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(
      ADMIN_RETURN_TO_HEADER,
      pathname + request.nextUrl.search
    );
    return NextResponse.next({ request: { headers: requestHeaders } });
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
     * - internal API routes
     * - public v1 API routes (route handlers own bearer authentication)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|fonts|images|api|v1).*)",
  ],
};
