# Firebase Auth Custom Subdomain — Fix for `signInWithRedirect` Cross-Origin Handoff Failure

**Date:** 2026-04-20
**Branch:** `feat/visual-system-foundation`
**Scope:** Move Firebase `authDomain` from `ops-ios-app.firebaseapp.com` to `auth.opsapp.co` so Google/Apple OAuth redirect flows survive Chrome's third-party storage partitioning.
**Status:** Diagnosed from Vercel logs. Fix is a mix of external config (DNS + Firebase Console + Google/Apple OAuth) and one code change.

---

## 0. Context for the executing agent

### The bug

User `j4ckson.sweet@gmail.com` was invited to join a company (invite code `canprodeckandrail`), landed on `https://app.opsapp.co/join?code=canprodeckandrail`, clicked "Continue with Google", completed the Google OAuth flow, and returned to the `/join` page **unauthenticated**. No console errors in Chrome DevTools. Auto-join never fired.

### What the Vercel logs proved

In the 24h window containing the failing attempt (2026-04-20, 18:40–18:45 UTC):

| Time (UTC) | Method | Path | Status |
|-----------|--------|------|--------|
| 18:40:54 | GET | `/api/invites/canprodeckandrail` | 200 |
| 18:41:38 | GET | `/api/invites/canprodeckandrail` | 200 |
| 18:45:30 | GET | `/api/invites/canprodeckandrail` | 200 |
| 18:45:42 | GET | `/api/invites/canprodeckandrail` | 200 |

**Zero** `POST /api/auth/sync-user` calls. **Zero** `POST /api/auth/join-company` calls.

Meaning: AuthProvider (`src/components/providers/auth-provider.tsx`) never saw a Firebase user on return from the Google redirect. `onAuthStateChanged` fired with `null`. The credential from the OAuth handshake never reached the app-origin `auth` instance.

For comparison, the pre-`815c1ab5` deployment (2026-04-19, 20:58–21:17 UTC) shows 6× `sync-user 200` — auth worked fine under `signInWithPopup`.

### Root cause

Commit `815c1ab5` (Apr 19 21:11) migrated OAuth from `signInWithPopup` to `signInWithRedirect` to eliminate the Cross-Origin-Opener-Policy console noise that `same-origin-allow-popups` introduced.

But `signInWithRedirect` has a Chrome regression when `authDomain` ≠ app-origin eTLD+1:

1. Browser → `https://ops-ios-app.firebaseapp.com/__/auth/handler` (Firebase authDomain)
2. → Google → back to same handler URL with the OAuth response
3. Firebase auth handler tries to ferry the credential back to the origin page at `https://app.opsapp.co/join` via a cross-origin helper iframe using `sessionStorage` + `postMessage`
4. **Chrome's third-party storage partitioning** (shipped in Chrome 115+, enforced 2024+) blocks the helper iframe from reading its own storage when embedded cross-origin
5. `getRedirectResult()` returns `null`, `onAuthStateChanged` fires `null`, no error thrown
6. User lands on `/join` in the same unauthenticated state they started in

This is documented in firebase-js-sdk#6716. Firebase's recommended mitigation is "Option 3 — use a custom subdomain that is same-site with your app domain". Chrome's storage partition treats `auth.opsapp.co` and `app.opsapp.co` as first-party to each other because they share the `opsapp.co` eTLD+1.

### Why we can't just revert or use the alternatives

- **Revert to `signInWithPopup`:** Regression. The COOP warnings return, and popup-based flows will hit other Chrome restrictions as third-party cookie deprecation continues. Firebase explicitly recommends migrating away from popups.
- **"Self-host the helper code" (Firebase Option 4):** No Apple Sign-In support per Firebase docs. We require Apple. This option is off the table.
- **Vercel rewrite `/__/auth/*` → Firebase:** Fragile. Firebase internals could change without notice. Not the blessed path.

### Verified environment state

- Firebase project: `ops-ios-app`
- Firebase Hosting: enabled, default site `ops-ios-app`, `https://ops-ios-app.web.app` responds (404 — nothing deployed, but auth handler is live at `/__/auth/*`)
- Firebase plan: Spark (free). Custom domains free on Spark, unlimited.
- Vercel project: `ops-web`, domains: `app.opsapp.co` (prod), `ops-web-opal.vercel.app`, plus per-branch preview URLs
- Apple Sign-In: Firebase `OAuthProvider("apple.com")` via Apple Service ID (web-based, not native `ASAuthorizationController`)
- DNS provider: GoDaddy (`opsapp.co`)
- Current env var: `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=ops-ios-app.firebaseapp.com`

### Target environment state

- `auth.opsapp.co` — custom domain on Firebase Hosting site `ops-ios-app`, SSL provisioned
- `auth.opsapp.co` — in Firebase Auth → Authorized domains
- `https://auth.opsapp.co` — in Google OAuth client → Authorized JavaScript origins
- `https://auth.opsapp.co/__/auth/handler` — in Google OAuth client → Authorized redirect URIs
- `https://auth.opsapp.co/__/auth/handler` — in Apple Service ID → Return URLs
- Vercel env (prod + preview + dev): `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=auth.opsapp.co`
- `.env.local`: same
- Committed to branch, deployed to prod

### Reading order before starting

1. This document top-to-bottom
2. `src/lib/firebase/config.ts` — understand how `authDomain` is consumed
3. `src/lib/firebase/auth.ts` — understand the redirect flow
4. `src/components/providers/auth-provider.tsx` — the consumer of the Firebase auth state

---

## 1. Phases and dependency order

Phases 1 and 2 are external configuration the human operator must do. Phase 3 is the code change I will execute. Phase 4 is verification.

**Critical ordering constraint:** Phase 3 env update MUST NOT ship until Phase 1 and Phase 2 are fully complete. If `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=auth.opsapp.co` ships while `auth.opsapp.co` is still DNS-provisioning, **every OAuth sign-in on the site will fail** (the Firebase SDK will try to redirect to a non-existent host).

---

## 2. Phase 1 — Firebase Hosting custom domain (human-driven)

### Task 1.1 — Add custom domain in Firebase Console

**Actor:** Jackson (human)
**Duration:** 5 min, then 5-10 min wait
**Precondition:** Signed in to Firebase Console as `j4ckson.sweet@gmail.com` (confirmed active user on `ops-ios-app`)

Steps:
1. Open `https://console.firebase.google.com/project/ops-ios-app/hosting/sites`
2. Click into site `ops-ios-app` (the default)
3. Click **Add custom domain**
4. Enter: `auth.opsapp.co`
5. Choose: **Quick setup** (NOT "redirect from another domain")
6. Uncheck "Set up as the default domain"
7. Click **Continue**
8. Firebase presents a TXT record for ownership verification. Copy:
   - Host: (typically `auth` or shown as `auth.opsapp.co` — check Firebase's exact instruction)
   - Type: `TXT`
   - Value: the `google-site-verification=...` token
9. **Do not close this Firebase tab** — you'll click "Verify" here after DNS propagates.

### Task 1.2 — Add TXT record in GoDaddy DNS

**Actor:** Jackson
**Duration:** 2 min, then 5-10 min wait for propagation

Steps:
1. Open `https://dcc.godaddy.com/manage/opsapp.co/dns`
2. Click **Add New Record**
3. Fields:
   - Type: `TXT`
   - Name: `auth` (if Firebase specified `auth.opsapp.co` as the host, the Name field is just `auth` since GoDaddy auto-appends the domain)
   - Value: paste the `google-site-verification=...` token exactly
   - TTL: `600 seconds` (low so propagation is quick; you can raise later)
4. Save
5. Verify propagation in a terminal:
   ```bash
   dig TXT auth.opsapp.co +short
   ```
   You should see your `google-site-verification=...` value. Takes 2-10 min with GoDaddy.

### Task 1.3 — Verify ownership in Firebase

**Actor:** Jackson
**Duration:** 1 min

1. Return to the Firebase Hosting tab from Task 1.1
2. Click **Verify**
3. If Firebase complains "not found", wait 5 more minutes and retry `dig` + Verify
4. Once verified, Firebase shows two A records to add. Copy both (usually two IPs like `151.101.1.195` / `151.101.65.195`).

### Task 1.4 — Add A records in GoDaddy DNS

**Actor:** Jackson
**Duration:** 3 min, then 5 min – 24 hr wait

Steps:
1. GoDaddy DNS → Add New Record (twice, one per IP):
   - Record 1: Type `A`, Name `auth`, Value `<first IP from Firebase>`, TTL `600`
   - Record 2: Type `A`, Name `auth`, Value `<second IP from Firebase>`, TTL `600`
2. Save both
3. Click **Finish** in Firebase Console

### Task 1.5 — Wait for SSL provisioning

**Actor:** Firebase (automated)
**Duration:** 5 min – 24 hr (usually under 30 min)

Polling command:
```bash
# Status should transition: Needs setup → Pending → Connected
firebase hosting:sites:get ops-ios-app --project ops-ios-app

# OR check the raw HTTPS cert once it provisions:
curl -sI https://auth.opsapp.co/__/auth/handler
# Expected response once live:
#   HTTP/2 200
#   content-type: text/html; charset=utf-8
```

**DO NOT proceed to Phase 3 until `curl -sI https://auth.opsapp.co/__/auth/handler` returns `200`.**

### Task 1.6 — (No commit — this phase is external config only.)

---

## 3. Phase 2 — Firebase + OAuth provider config (human-driven)

### Task 2.1 — Add `auth.opsapp.co` to Firebase Auth authorized domains

**Actor:** Jackson
**Duration:** 1 min
**Precondition:** Phase 1 complete

1. Open `https://console.firebase.google.com/project/ops-ios-app/authentication/settings`
2. Scroll to **Authorized domains**
3. Click **Add domain**
4. Enter: `auth.opsapp.co`
5. Click **Add**

### Task 2.2 — Update Google OAuth 2.0 Web client

**Actor:** Jackson
**Duration:** 3 min
**Precondition:** none (can be done in parallel with 2.1)

1. Open `https://console.cloud.google.com/apis/credentials?project=ops-ios-app`
2. Find the **OAuth 2.0 Client IDs** row labeled "Web client" (the one used by Firebase Auth — its client ID matches what Firebase uses internally; if there are multiple, the correct one is typically the one labeled "Web client (auto created by Google Service)")
3. Click the edit (pencil) icon
4. Under **Authorized JavaScript origins**, click **Add URI**:
   - Value: `https://auth.opsapp.co`
5. Under **Authorized redirect URIs**, click **Add URI**:
   - Value: `https://auth.opsapp.co/__/auth/handler`
6. Click **Save**
7. **Note:** Google OAuth changes can take up to 5 minutes to propagate.

### Task 2.3 — Update Apple Service ID return URL

**Actor:** Jackson
**Duration:** 3 min

1. Open `https://developer.apple.com/account/resources/identifiers/list/serviceId`
2. Click the OPS Service ID (the one configured for Sign In with Apple — its identifier usually matches a reverse-DNS string like `co.opsapp.ops.auth`; check Firebase Console → Authentication → Apple provider for the exact Service ID value)
3. Under **Sign In with Apple** → click **Configure**
4. Under **Return URLs**, add a new entry:
   - Value: `https://auth.opsapp.co/__/auth/handler`
5. Click **Done** → **Save** → **Continue** → **Save**
6. Apple will require re-agreeing to terms; do that if prompted.

### Task 2.4 — Manual verification of OAuth client configs

**Actor:** Jackson
**Duration:** 2 min

Before moving to Phase 3, sanity check that you can still load the existing prod flow using the OLD authDomain. This confirms the OAuth client config changes above haven't broken anything:

1. Open incognito Chrome → `https://app.opsapp.co/login`
2. Click Continue with Google
3. Should redirect through `ops-ios-app.firebaseapp.com`, complete, land on `/dashboard` or `/setup`

If this still works, OAuth client changes are additive (they should be). If it's broken, roll back Task 2.2/2.3 and investigate before continuing.

---

## 4. Phase 3 — Code + Vercel env flip (agent-driven)

**Precondition: Phase 1 complete AND Phase 2 complete AND `curl -sI https://auth.opsapp.co/__/auth/handler` returns `200`.**

The agent executing this plan must verify the precondition by running the curl command. If it returns anything other than 200, stop and escalate.

### Task 3.1 — Update `.env.local`

**Actor:** Agent
**Duration:** 30s
**File:** `/Users/jacksonsweet/Projects/OPS/OPS-Web/.env.local`

Change:
```diff
-NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="ops-ios-app.firebaseapp.com"
+NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="auth.opsapp.co"
```

Use the `Edit` tool. `.env.local` is gitignored — this change is local-dev only and does NOT go into the commit.

### Task 3.2 — Update Vercel env vars (all three environments)

**Actor:** Agent
**Duration:** 2 min
**Tool:** Vercel CLI

Commands to run from `/Users/jacksonsweet/Projects/OPS/OPS-Web`:

```bash
# Remove the old value (all three envs) — non-interactive
vercel env rm NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN production --yes
vercel env rm NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN preview --yes
vercel env rm NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN development --yes

# Add the new value (all three envs). The CLI prompts for the value on stdin —
# pipe it in so this can run non-interactively.
echo "auth.opsapp.co" | vercel env add NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN production
echo "auth.opsapp.co" | vercel env add NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN preview
echo "auth.opsapp.co" | vercel env add NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN development

# Verify all three now say auth.opsapp.co
vercel env ls
```

The `vercel env ls` output should show three rows for `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, all pointing to `auth.opsapp.co` (or masked, in which case pull the values into a temp file to verify):

```bash
vercel env pull /tmp/.verify-env.production.txt --environment production --yes
grep '^NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=' /tmp/.verify-env.production.txt
# Expected:
#   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="auth.opsapp.co"
rm /tmp/.verify-env.production.txt
```

### Task 3.3 — Commit

**Actor:** Agent
**Duration:** 30s

Nothing in the repo actually changed in this phase (env vars live outside git, `.env.local` is gitignored). Skip this task and go straight to Task 3.4.

However, we WILL commit a docs-only change in Task 3.5 below so the plan is captured on the branch.

### Task 3.4 — Redeploy prod

**Actor:** Agent
**Duration:** 3-5 min

Env var changes in Vercel do not trigger an automatic redeploy. We need to redeploy prod for the new value to take effect in built assets (the value is embedded as `NEXT_PUBLIC_*` at build time):

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
vercel --prod
```

Wait for the deploy to complete. Capture the new deployment URL.

Verify the build picked up the new value:
```bash
# Download the new client bundle and grep for the authDomain value
DEPLOY_URL=$(vercel ls --limit 1 | awk 'NR==2 {print $2}')
# The built chunk will contain "authDomain:auth.opsapp.co" literal
curl -s https://app.opsapp.co/_next/static/chunks/app/layout-*.js 2>/dev/null | head -c 100000 | grep -o 'authDomain:"[^"]*"' | head -1
# Expected: authDomain:"auth.opsapp.co"
```

If the grep returns `authDomain:"ops-ios-app.firebaseapp.com"`, the build used stale env — force a fresh build:

```bash
vercel --prod --force
```

### Task 3.5 — Commit plan doc

**Actor:** Agent
**Duration:** 30s

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
git add docs/superpowers/plans/2026-04-20-auth-subdomain-fix.md
git commit -m "$(cat <<'EOF'
docs(auth): plan — migrate authDomain to auth.opsapp.co subdomain

Firebase signInWithRedirect silently fails on Chrome when authDomain is
on a different eTLD+1 than the app origin — Chrome's third-party
storage partitioning blocks the credential handoff iframe. Symptom:
/join?code=X returns from Google OAuth unauthenticated with no console
error, zero /api/auth/sync-user calls in Vercel logs.

Plan moves authDomain from ops-ios-app.firebaseapp.com to auth.opsapp.co
(same-site with app.opsapp.co), which Chrome treats as first-party and
allows the credential handoff.

Bug: /join OAuth returns unauthenticated after commit 815c1ab5
(signInWithRedirect migration on 2026-04-19).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 5. Phase 4 — Verification (agent-driven + human confirmation)

### Task 4.1 — Smoke test prod OAuth — Google

**Actor:** Jackson, tailed by agent via Vercel logs

1. Open a fresh Chrome incognito window (no stale cookies)
2. Navigate to `https://app.opsapp.co/join?code=canprodeckandrail`
3. Wait for invite details to load
4. Click **Continue with Google**
5. Complete Google OAuth with `j4ckson.sweet@gmail.com`
6. Expected: lands on `https://app.opsapp.co/join/welcome?company=<uuid>`

### Task 4.2 — Confirm from Vercel logs

**Actor:** Agent

Run via MCP:
```
mcp__plugin_vercel_vercel__get_runtime_logs(
  projectId="prj_hglAp4p8MWheqpQn0UDTygVwlziU",
  teamId="team_zxfRqTDMWynswbBaqX7OQxOY",
  query="/api/auth",
  since="15m",
  limit=20
)
```

Expected sequence:
```
| GET  | /api/invites/canprodeckandrail  | 200 |
| POST | /api/auth/sync-user              | 200 |
| POST | /api/auth/join-company           | 200 |
```

All three must appear within ~5 seconds of each other.

### Task 4.3 — Smoke test prod OAuth — Apple

**Actor:** Jackson

1. Fresh incognito → `https://app.opsapp.co/register`
2. Click **Continue with Apple**
3. Complete Apple ID flow (use "Share My Email" to avoid polluting real address)
4. Expected: lands on `/account-type`

### Task 4.4 — Smoke test login flow

**Actor:** Jackson

1. Fresh incognito → `https://app.opsapp.co/login`
2. Click **Continue with Google**
3. Expected: lands on `/dashboard` (user has company) or `/account-type` (user has no company)

### Task 4.5 — Pre-migration sign-outs still work

**Actor:** Jackson

Sign out a known user who signed in BEFORE this change. Expected: clean sign-out, lands on `/login`, no stale auth state. This verifies the `authDomain` change doesn't invalidate existing sessions.

---

## 6. Rollback plan

If Phase 4 fails:

### Rollback 3.2 — Revert Vercel env

```bash
vercel env rm NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN production --yes
vercel env rm NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN preview --yes
vercel env rm NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN development --yes

echo "ops-ios-app.firebaseapp.com" | vercel env add NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN production
echo "ops-ios-app.firebaseapp.com" | vercel env add NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN preview
echo "ops-ios-app.firebaseapp.com" | vercel env add NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN development

vercel --prod --force
```

This returns the site to the (broken) pre-fix state. Investigate before re-attempting.

### Rollback DNS / Firebase / OAuth providers

The Firebase custom domain, DNS records, and OAuth authorized URIs are all additive — they can stay. Nothing in the app depends on `auth.opsapp.co` NOT existing.

---

## 7. Preview deployments — not in scope

Vercel preview deployments have unique per-branch URLs (e.g. `ops-web-git-feat-visual-system-foundation-*.vercel.app`). For OAuth to work on previews, each would need to be an "authorized domain" in Firebase Auth.

Options for a future plan (NOT this one):
- Add `*.vercel.app` wildcard to Firebase authorized domains (Firebase supports limited wildcards)
- Accept that OAuth doesn't work on previews and require email+password for preview testing
- Create a single dedicated preview alias (e.g. `preview.opsapp.co`) and route all preview traffic there via Vercel

None of these are required to fix the production bug. Handle separately.

---

## 8. Unknowns / explicit assumptions

- **Apple Service ID name**: I don't know the exact Service ID identifier for OPS's Apple Sign-In. Jackson will find it in Apple Developer Console. The Firebase Console → Authentication → Sign-in method → Apple tab displays the Service ID in use.
- **Google OAuth client identification**: multiple OAuth clients may exist in the GCP project; the "Web client" one used by Firebase Auth is the target. Firebase Console → Project settings → General → Web SDK snippet shows the `apiKey`; the OAuth client ID matches what you'd find in Cloud Console → Credentials filtered by "OAuth 2.0 Client IDs" → "Web client".
- **GoDaddy DNS UI**: I'm describing the flow as of my last observation. If GoDaddy's UI has changed, adapt. The records themselves (1× TXT + 2× A on `auth` host) are what matters.

---

## 9. Future hardening (separate plans)

Once this fix ships, consider:

- Adding `auth.opsapp.co` SSL monitoring (uptime check on `/__/auth/handler` returning 200)
- Documenting the "authorized domain required for each Vercel preview URL" constraint in `OPS-Web/CLAUDE.md`
- Consolidating all Firebase env vars into a single `firebase.env.example` so new environments don't miss `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`

None of these are blockers.
