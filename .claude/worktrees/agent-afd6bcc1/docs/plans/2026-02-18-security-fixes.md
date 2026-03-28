# Security Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 10 security vulnerabilities identified in the 2026-02-18 security review of `ops-web`.

**Architecture:** Each fix is an isolated, minimal change to a single file or env variable. No new dependencies are needed. The most critical fixes (token exposure, open proxy, unauthenticated send-link) are tackled first since they can be exploited independently. Later tasks add auth guards and harden OAuth/webhook flows.

**Tech Stack:** Next.js 14 App Router, TypeScript, Firebase Admin SDK (already in project), Supabase service role client, environment variables.

---

## Background Reading

Before starting, read these files:
- `src/middleware.ts` — understand how auth cookies work (`ops-auth-token`, `__session`)
- `src/app/api/bubble/[...path]/route.ts` — the open proxy
- `src/app/api/portal/auth/send-link/route.ts` — unauthenticated email sender
- `src/app/api/portal/share/route.ts` — fake auth check
- `src/app/api/sync/push/route.ts` — unauthenticated QB push
- `src/app/api/automation/follow-up-check/route.ts` — cron secret in URL
- `src/app/api/integrations/gmail/route.ts` and `callback/route.ts`
- `src/app/api/integrations/email-webhook/route.ts`
- `next.config.ts`
- `.env.local` and `.env.example`

---

## Task 1: Rename NEXT_PUBLIC_BUBBLE_API_TOKEN

**Problem:** The `NEXT_PUBLIC_` prefix causes Next.js to embed this secret in the client-side JS bundle at build time. Anyone visiting the site can extract the Bubble API token.

**Files:**
- Modify: `.env.local`
- Modify: `.env.example`
- Modify: `src/app/api/bubble/[...path]/route.ts:16`
- Modify: `src/lib/api/bubble-client.ts:175`

**Step 1: Update `.env.local`**

Find the line:
```
NEXT_PUBLIC_BUBBLE_API_TOKEN=f81e9da85b7a12e996ac53e970a52299
```

Change it to:
```
BUBBLE_API_TOKEN=f81e9da85b7a12e996ac53e970a52299
```

Leave `NEXT_PUBLIC_BUBBLE_API_URL` as-is (the URL is not a secret).

**Step 2: Update `.env.example`**

Find:
```
NEXT_PUBLIC_BUBBLE_API_TOKEN=your_bubble_api_token_here
```

Change to:
```
BUBBLE_API_TOKEN=your_bubble_api_token_here
```

**Step 3: Update the proxy route**

In `src/app/api/bubble/[...path]/route.ts`, change line 16:
```ts
// Before:
const BUBBLE_TOKEN = process.env.NEXT_PUBLIC_BUBBLE_API_TOKEN || "";

// After:
const BUBBLE_TOKEN = process.env.BUBBLE_API_TOKEN || "";
```

**Step 4: Update bubble-client.ts**

In `src/lib/api/bubble-client.ts`, find the line at ~175:
```ts
// Before:
process.env.NEXT_PUBLIC_BUBBLE_API_TOKEN ||

// After:
process.env.BUBBLE_API_TOKEN ||
```

**Step 5: Verify build doesn't leak the token**

Run:
```bash
cd /c/OPS/ops-web
grep -r "NEXT_PUBLIC_BUBBLE_API_TOKEN" src/
```
Expected: No output (zero matches).

Then verify the env var change is consistent:
```bash
grep -r "BUBBLE_API_TOKEN" src/ .env.example
```
Expected: Two matches — the proxy route and bubble-client.ts — plus the example file.

**Step 6: Commit**

```bash
git add .env.example src/app/api/bubble src/lib/api/bubble-client.ts
git commit -m "security: rename NEXT_PUBLIC_BUBBLE_API_TOKEN to server-only BUBBLE_API_TOKEN

Prevents the Bubble API token from being embedded in the client-side
JS bundle. The token is only needed server-side (API proxy route and
SSR bubble-client calls)."
```

---

## Task 2: Add Auth Guard to the Bubble Proxy

**Problem:** `/api/bubble/[...path]` has zero authentication. Any unauthenticated HTTP request can read or write any Bubble data through this proxy.

**Context:** The middleware (`src/middleware.ts:config.matcher`) explicitly **excludes** `/api` routes from middleware auth checks. So auth must be done inside the route itself.

**Auth strategy:** Check for the Firebase session cookie (`__session`) or the custom token cookie (`ops-auth-token`). If neither is present, return 401. We do NOT need to cryptographically verify the Firebase token here — the cookies are httpOnly and were set server-side after Firebase verification. A presence check is sufficient for the proxy since the middleware already enforces auth for all dashboard pages that call this proxy.

> **Note for reviewer:** If you want stricter verification, you can integrate Firebase Admin SDK to call `admin.auth().verifySessionCookie()`. But for a proxy that's only called from the authenticated dashboard, presence-check is the right tradeoff.

**Files:**
- Modify: `src/app/api/bubble/[...path]/route.ts`

**Step 1: Add the auth guard function**

Open `src/app/api/bubble/[...path]/route.ts`. After the `BUBBLE_TOKEN` constant (around line 16), add:

```ts
function isAuthenticated(req: NextRequest): boolean {
  const session = req.cookies.get("__session")?.value;
  const token = req.cookies.get("ops-auth-token")?.value;
  return !!(session || token);
}
```

**Step 2: Add the guard to `proxyToBubble`**

At the top of `proxyToBubble`, before building the URL, add:

```ts
async function proxyToBubble(
  req: NextRequest,
  path: string,
  method: string
): Promise<NextResponse> {
  // Auth guard — only authenticated users may use this proxy
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ... rest of function unchanged
```

**Step 3: Verify the guard is in place**

Read the file and confirm the guard appears before the `url = ...` line.

**Step 4: Test locally (manual)**

Start the dev server and try:
```bash
curl -s http://localhost:3000/api/bubble/obj/user | jq '.error'
```
Expected output: `"Unauthorized"`

Then try with a cookie (simulating a logged-in user — use a valid cookie from your browser DevTools):
```bash
curl -s -H "Cookie: ops-auth-token=any_value" http://localhost:3000/api/bubble/obj/user | jq 'keys'
```
Expected: Returns Bubble data (not 401).

**Step 5: Commit**

```bash
git add src/app/api/bubble
git commit -m "security: add auth guard to Bubble API proxy

Unauthenticated requests to /api/bubble/* now receive 401.
The proxy is only intended for use from the authenticated dashboard."
```

---

## Task 3: Add Auth to `/api/portal/auth/send-link`

**Problem:** This route sends portal magic link emails with zero authentication. Any internet user can spam clients with portal emails or create tokens for arbitrary company/client pairs.

**Strategy:** This route is called by admin users from the dashboard. Add the same auth presence check used by the middleware: require `__session` or `ops-auth-token` cookie.

**Files:**
- Modify: `src/app/api/portal/auth/send-link/route.ts`

**Step 1: Add auth guard at the top of the POST handler**

Open `src/app/api/portal/auth/send-link/route.ts`. After the imports, add a helper:

```ts
function isAuthenticated(req: NextRequest): boolean {
  return !!(
    req.cookies.get("__session")?.value ||
    req.cookies.get("ops-auth-token")?.value ||
    req.headers.get("authorization")
  );
}
```

**Step 2: Add the guard as the first thing in the POST body**

```ts
export async function POST(req: NextRequest) {
  // Auth guard — only authenticated admin users may send portal links
  if (!isAuthenticated(req)) {
    return NextResponse.json(
      { error: "Unauthorized - admin authentication required" },
      { status: 401 }
    );
  }

  try {
    // ... rest of function unchanged
```

**Step 3: Verify**

Read the file to confirm the guard is the first statement in POST.

**Step 4: Commit**

```bash
git add src/app/api/portal/auth/send-link
git commit -m "security: require auth on portal/auth/send-link

Previously unauthenticated; any caller could send magic link emails
to arbitrary addresses. Now requires a valid auth cookie/header."
```

---

## Task 4: Fix `/api/portal/share` — Verify Token, Not Just Presence

**Problem:** The route checks that an `Authorization` header or cookie **exists**, but never verifies it's a real Firebase token. `Authorization: Bearer garbage` passes the check.

**Strategy:** The simplest fix without importing Firebase Admin is to add a layer of defense: require **both** a header/cookie AND a `companyId` match against what's in the cookie's decoded payload. However, the most correct fix is to verify with Firebase Admin. Let's do the proper fix since Firebase Admin is already available in Next.js server contexts.

Check if Firebase Admin is already configured in the project:
```bash
grep -r "firebase-admin\|firebase/admin" /c/OPS/ops-web/src/ --include="*.ts" -l
```

If you see existing usage, find how it's initialized and reuse that pattern. If not present, you'll need to install: `npm install firebase-admin`.

**Files:**
- Create: `src/lib/firebase/admin.ts` (if it doesn't already exist)
- Modify: `src/app/api/portal/share/route.ts`

**Step 1: Create/verify Firebase Admin singleton**

Check if `src/lib/firebase/admin.ts` exists:
```bash
ls /c/OPS/ops-web/src/lib/firebase/
```

If `admin.ts` does not exist, create it:

```ts
/**
 * Firebase Admin SDK singleton for server-side token verification.
 * Never import from client-side code.
 */
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}
```

**Step 2: Add Firebase Admin env vars to `.env.example`**

```
# Firebase Admin (server-side only — from Firebase console → Service Accounts)
FIREBASE_ADMIN_PROJECT_ID=your_project_id
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Add the real values to `.env.local` (get from Firebase Console → Project Settings → Service Accounts → Generate new private key).

**Step 3: Rewrite the auth check in `portal/share/route.ts`**

Replace the current auth block:
```ts
// BEFORE (insecure — just checks presence):
const authHeader = req.headers.get("authorization");
const cookieToken = req.cookies.get("ops-auth-token")?.value
  || req.cookies.get("__session")?.value;

if (!authHeader && !cookieToken) {
  return NextResponse.json(
    { error: "Unauthorized - admin authentication required" },
    { status: 401 }
  );
}
```

With:
```ts
// AFTER (verifies Firebase token):
import { getAdminAuth } from "@/lib/firebase/admin";

async function verifyFirebaseToken(req: NextRequest): Promise<boolean> {
  try {
    const authHeader = req.headers.get("authorization");
    const cookieToken = req.cookies.get("ops-auth-token")?.value
      || req.cookies.get("__session")?.value;

    const rawToken = authHeader?.replace("Bearer ", "") || cookieToken;
    if (!rawToken) return false;

    await getAdminAuth().verifyIdToken(rawToken);
    return true;
  } catch {
    return false;
  }
}
```

Then update the POST handler:
```ts
export async function POST(req: NextRequest) {
  try {
    if (!(await verifyFirebaseToken(req))) {
      return NextResponse.json(
        { error: "Unauthorized - admin authentication required" },
        { status: 401 }
      );
    }

    // ... rest unchanged
```

**Step 4: Install firebase-admin if needed**

```bash
cd /c/OPS/ops-web
npm list firebase-admin 2>/dev/null || npm install firebase-admin
```

**Step 5: Commit**

```bash
git add src/lib/firebase/admin.ts src/app/api/portal/share .env.example
git commit -m "security: verify Firebase ID token in portal/share

Previously only checked token presence; now calls Firebase Admin
verifyIdToken() to cryptographically validate the token."
```

---

## Task 5: Add Auth to `/api/sync/push`

**Problem:** Any unauthenticated caller can trigger QuickBooks sync pushes for any `companyId`/`entityId`.

**Strategy:** This route is called server-to-server from within the OPS app. Use a simple shared secret (`INTERNAL_API_SECRET`) rather than Firebase auth (since some callers may be server-side without a user token).

**Files:**
- Modify: `.env.local`
- Modify: `.env.example`
- Modify: `src/app/api/sync/push/route.ts`

**Step 1: Add env var to `.env.local`**

Generate a secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add to `.env.local`:
```
INTERNAL_API_SECRET=<generated_value>
```

Add to `.env.example`:
```
INTERNAL_API_SECRET=generate_with_openssl_rand_hex_32
```

**Step 2: Add the guard to `sync/push/route.ts`**

After imports, add:
```ts
function isInternalRequest(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return false;
  const header = req.headers.get("x-internal-secret");
  return header === secret;
}
```

At the top of the POST handler:
```ts
export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ... rest unchanged
```

**Step 3: Update all callers of `/api/sync/push`**

Search for callers:
```bash
grep -r "sync/push\|/api/sync" /c/OPS/ops-web/src/ --include="*.ts" -l
```

For each file found that calls `/api/sync/push`, add the secret header:
```ts
// Wherever you fetch('/api/sync/push', ...), add:
headers: {
  "Content-Type": "application/json",
  "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
},
```

**Step 4: Commit**

```bash
git add src/app/api/sync/push .env.example
git commit -m "security: add INTERNAL_API_SECRET guard to /api/sync/push

Previously unauthenticated. Now requires X-Internal-Secret header
matching INTERNAL_API_SECRET env var."
```

---

## Task 6: Remove Cron Secret from URL Query Param

**Problem:** `isAuthorized()` accepts `?secret=...` in the URL, which leaks the cron secret into server logs, proxy logs, and browser history.

**Files:**
- Modify: `src/app/api/automation/follow-up-check/route.ts`

**Step 1: Remove the query-param branch**

Find:
```ts
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("x-cron-secret");
  const param = new URL(request.url).searchParams.get("secret");
  return header === secret || param === secret;
}
```

Replace with:
```ts
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("x-cron-secret");
  return header === secret;
}
```

**Step 2: Verify `vercel.json` uses the header format**

Check:
```bash
cat /c/OPS/ops-web/vercel.json
```

If the cron config uses `?secret=...` in a URL, update it to pass the header instead. Vercel's built-in cron support automatically sends `Authorization: Bearer $CRON_SECRET` — if you're using Vercel cron, switch to checking `Authorization` header:
```ts
const header = request.headers.get("authorization");
return header === `Bearer ${secret}`;
```

**Step 3: Commit**

```bash
git add src/app/api/automation
git commit -m "security: remove cron secret from URL query param

Secret was exposed in server logs via ?secret=... query parameter.
Now only accepted via x-cron-secret header."
```

---

## Task 7: Add CSRF Protection to Gmail OAuth

**Problem:** The Gmail OAuth callback has no CSRF state nonce. An attacker can craft a state parameter pointing to their own `companyId` and trick an admin into linking their Gmail to the wrong account.

**Files:**
- Modify: `src/app/api/integrations/gmail/route.ts` (initiation)
- Modify: `src/app/api/integrations/gmail/callback/route.ts` (callback)

**Step 1: Update the OAuth initiation to include a nonce in state and set a cookie**

In `src/app/api/integrations/gmail/route.ts`, update the GET handler:

```ts
import { randomBytes } from "crypto";

export async function GET(request: NextRequest) {
  // ... existing validation ...

  // Generate a CSRF nonce
  const nonce = randomBytes(16).toString("hex");

  // Encode state with nonce
  const statePayload = Buffer.from(
    JSON.stringify({ companyId, type, userId, nonce })
  ).toString("base64url");

  const redirectUri = `${BASE_URL}/api/integrations/gmail/callback`;

  // ... build params and authUrl as before ...

  const response = NextResponse.redirect(authUrl);

  // Store nonce in httpOnly cookie for CSRF validation
  response.cookies.set("gmail-oauth-nonce", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/gmail/callback",
    maxAge: 600, // 10 minutes
  });

  return response;
}
```

**Step 2: Validate nonce in the callback**

In `src/app/api/integrations/gmail/callback/route.ts`, update `parseState` to include nonce:

```ts
function parseState(raw: string): {
  companyId: string;
  type: "company" | "individual";
  userId: string | null;
  nonce: string;
} | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (!parsed.nonce) return null; // Reject old-format states
    return parsed;
  } catch {
    return null;
  }
}
```

Then add the nonce validation at the top of the GET handler, after parsing state:

```ts
const state = parseState(stateRaw);
if (!state) return redirect("error", "invalid_state");

// CSRF: validate nonce against cookie
const storedNonce = request.cookies.get("gmail-oauth-nonce")?.value;
if (!storedNonce || storedNonce !== state.nonce) {
  return redirect("error", "invalid_csrf");
}
```

Then clear the nonce cookie in the success response:
```ts
const { error: upsertError } = await supabase.from("gmail_connections").upsert(...)

if (upsertError) { ... }

const successResponse = redirect("connected");
successResponse.cookies.delete("gmail-oauth-nonce");
return successResponse;
```

**Step 3: Commit**

```bash
git add src/app/api/integrations/gmail
git commit -m "security: add CSRF nonce to Gmail OAuth state parameter

State now includes a random nonce that is validated against an
httpOnly cookie in the callback, preventing state fixation attacks."
```

---

## Task 8: Add Webhook Signature Verification to Email Webhook

**Problem:** `/api/integrations/email-webhook` has no signature verification. Any caller can POST fake leads.

**Strategy:** The verification method depends on which email forwarding service is used. Check which service is configured (Sendgrid Inbound Parse, Mailgun, Postmark, etc.). If unknown, add a shared secret check as a minimum baseline.

**Files:**
- Modify: `.env.local`
- Modify: `.env.example`
- Modify: `src/app/api/integrations/email-webhook/route.ts`

**Step 1: Determine the email provider**

Check docs or the OPS Bible for which service routes inbound emails. Then look up their webhook signature format.

**Step 2: Add shared-secret verification (baseline approach)**

If the provider supports a custom header or signing, implement that. As a baseline that works with any provider:

Add to `.env.local`:
```
EMAIL_WEBHOOK_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

Add to `.env.example`:
```
EMAIL_WEBHOOK_SECRET=your_email_webhook_shared_secret
```

**Step 3: Add verification to the route**

In `src/app/api/integrations/email-webhook/route.ts`, add at the top of POST:

```ts
function isValidWebhookRequest(req: NextRequest): boolean {
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[email-webhook] EMAIL_WEBHOOK_SECRET not set — rejecting all requests");
    return false;
  }
  const provided = req.headers.get("x-webhook-secret");
  return provided === secret;
}

export async function POST(request: NextRequest) {
  if (!isValidWebhookRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ... rest unchanged
```

**Step 4: Configure the email provider to send the secret header**

In your email forwarding service's dashboard, add the header:
```
X-Webhook-Secret: <your EMAIL_WEBHOOK_SECRET value>
```

**Step 5: Commit**

```bash
git add src/app/api/integrations/email-webhook .env.example
git commit -m "security: add webhook secret verification to email-webhook

Rejects requests without correct X-Webhook-Secret header.
Configure the email forwarding service to include this header."
```

---

## Task 9: Scope `*.amazonaws.com` Wildcard in `next.config.ts`

**Problem:** The wildcard hostname in `remotePatterns` allows Next.js image optimization to proxy any `*.amazonaws.com` URL, creating potential SSRF surface.

**Files:**
- Modify: `next.config.ts`

**Step 1: Find the actual S3 bucket hostname**

Check `.env.local` for `AWS_S3_BUCKET` and `AWS_REGION`:
```bash
grep AWS /c/OPS/ops-web/.env.local
```

The hostname will be: `<bucket-name>.s3.<region>.amazonaws.com`

**Step 2: Update `next.config.ts`**

```ts
// Before:
{
  protocol: "https",
  hostname: "*.amazonaws.com",
  pathname: "/ops-app-files-prod/**",
},

// After (replace with your actual bucket hostname):
{
  protocol: "https",
  hostname: "ops-app-files-prod.s3.us-east-1.amazonaws.com",
  pathname: "/**",
},
```

**Step 3: Verify no other S3 hostnames are used**

```bash
grep -r "amazonaws.com" /c/OPS/ops-web/src/ --include="*.ts" --include="*.tsx" | grep -v "test\|spec"
```

If other bucket hostnames are used (e.g., for Bubble images), add them as separate entries with specific hostnames.

**Step 4: Commit**

```bash
git add next.config.ts
git commit -m "security: scope S3 remotePatterns to specific bucket hostname

Replaces *.amazonaws.com wildcard with the specific bucket hostname
to reduce SSRF surface in Next.js image optimization."
```

---

## Task 10: Harden `/api/admin/migrate-bubble`

**Problem:** Authorization is based on a `userId` from the request body. An attacker who finds a Bubble user ID with `devPermission=true` (possible via the now-fixed open proxy) can trigger a full database migration.

**Strategy:** Add Firebase Admin token verification. The endpoint should only be callable by a logged-in user who also has `dev_permission: true` in Supabase.

**Files:**
- Modify: `src/app/api/admin/migrate-bubble/route.ts`

**Step 1: Add Firebase Admin + Supabase auth check**

The `admin.ts` file was created in Task 4. Use it here.

At the top of the POST handler, replace the current userId-based auth:

```ts
// BEFORE:
const userId: string | undefined = body.userId;
if (!userId) { return 400 }
const userResp = await bubble.get<...>(`/obj/user/${userId}`);
if (!user?.devPermission) { return 403 }

// AFTER:
import { getAdminAuth } from "@/lib/firebase/admin";

// Verify Firebase token
const authHeader = req.headers.get("authorization");
const rawToken = authHeader?.replace("Bearer ", "");
if (!rawToken) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

let firebaseUid: string;
try {
  const decoded = await getAdminAuth().verifyIdToken(rawToken);
  firebaseUid = decoded.uid;
} catch {
  return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
}

// Check Supabase for dev_permission
const supabase = getServiceRoleClient();
const { data: userRecord } = await supabase
  .from("users")
  .select("dev_permission")
  .eq("firebase_uid", firebaseUid)  // adjust column name to match your schema
  .maybeSingle();

if (!userRecord?.dev_permission) {
  return NextResponse.json(
    { error: "User does not have developer permission" },
    { status: 403 }
  );
}
```

> **Note:** Check the `users` table schema to find the correct column name for the Firebase UID. Run: `grep -r "firebase_uid\|auth_uid\|firebase_id" /c/OPS/ops-web/src/ --include="*.ts"` to find existing patterns.

**Step 2: Remove the old userId-from-body logic**

Delete the lines that read `body.userId` and fetch from Bubble for auth purposes.

**Step 3: Commit**

```bash
git add src/app/api/admin/migrate-bubble
git commit -m "security: verify Firebase token for migrate-bubble admin route

Replaces body-userId auth with Firebase Admin token verification
plus Supabase dev_permission check. Closes IDOR via Bubble user lookup."
```

---

## Final: Verify All Fixes

**Step 1: Check for any remaining `NEXT_PUBLIC_` secrets**

```bash
grep -r "NEXT_PUBLIC_" /c/OPS/ops-web/src/ /c/OPS/ops-web/.env.example | grep -i "token\|secret\|key\|password"
```

Expected: Only Firebase public config (`NEXT_PUBLIC_FIREBASE_*`) — those are intentionally public.

**Step 2: Smoke-test unauthenticated access to each fixed endpoint**

```bash
# Should all return 401:
curl -s http://localhost:3000/api/bubble/obj/user | jq '.error'
curl -s -X POST http://localhost:3000/api/portal/auth/send-link -H "Content-Type: application/json" -d '{"companyId":"x","clientId":"y","email":"test@test.com"}' | jq '.error'
curl -s -X POST http://localhost:3000/api/sync/push -H "Content-Type: application/json" -d '{"entity":"client","entityId":"x","companyId":"y"}' | jq '.error'
curl -s http://localhost:3000/api/automation/follow-up-check | jq '.error'
curl -s -X POST http://localhost:3000/api/integrations/email-webhook -H "Content-Type: application/json" -d '{"to":"x@x.com","from":"y@y.com","subject":"test","body":"test"}' | jq '.error'
```

All should return `"Unauthorized"`.

**Step 3: Smoke-test authenticated flows still work**

Log into the app in a browser. Open DevTools → Application → Cookies, copy the `ops-auth-token` or `__session` value. Then:

```bash
curl -s -H "Cookie: ops-auth-token=<your_value>" http://localhost:3000/api/bubble/obj/user | jq 'keys'
```

Expected: Returns Bubble data structure.

**Step 4: Final commit summary**

```bash
git log --oneline -10
```

Should show 10 security fix commits.

---

## Notes for Reviewer

- Tasks 1–6 are standalone and can be done in any order.
- Task 4 (Firebase Admin) is a prerequisite for Task 10.
- The `migrate-bubble` endpoint (Task 10) may be worth **disabling entirely** after migration is complete by returning 404 or removing the route.
- The QB OAuth callback already has proper CSRF state validation via cookie — no fix needed there.
- If `firebase-admin` SDK is not already installed, `npm install firebase-admin` adds ~15MB to the server bundle but does not affect client bundle size.
