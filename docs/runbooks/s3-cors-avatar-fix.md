# Runbook: Fix S3 CORS for Profile Images (`ops-app-files-prod`)

**Status:** Open — requires manual AWS console actions.
**Owner:** Jackson.
**Date opened:** 2026-04-19.
**Bug:** `ebc06dc2-3af4-4e0e-b14b-af3e73746496`.

## Symptom

Profile avatars fail to load in the web app. Browser console shows:

```
Access to fetch at 'https://ops-app-files-prod.s3.us-west-2.amazonaws.com/company-.../profiles/profile_...jpg'
from origin 'https://app.opsapp.co' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

Followed by `net::ERR_FAILED` on the same URL. Every page that renders `<UserAvatar />` (TopBar, Setup, Dashboard, Project members, Comments) shows the placeholder fallback instead of the user's photo.

## Root Cause

The `ops-app-files-prod` S3 bucket has no CORS configuration. S3 buckets default to rejecting cross-origin requests outright — no `Access-Control-Allow-Origin` header is emitted, so browsers block the response before it's read.

Profile images were migrated from Supabase Storage to S3 in the last migration batch (see memory: `project_s3_image_migration.md`). Supabase Storage emits permissive CORS headers by default; S3 does not. The CORS config was not part of the migration checklist — this runbook adds it.

## Part 1 — AWS S3 console (manual)

You are logged into the AWS console with permissions on `ops-app-files-prod`. Target region: `us-west-2`.

### 1.1 Open the bucket

1. Go to https://us-west-2.console.aws.amazon.com/s3/buckets/ops-app-files-prod
2. Click the **Permissions** tab.
3. Scroll to **Cross-origin resource sharing (CORS)**.
4. Click **Edit**.

### 1.2 Paste the CORS configuration

Paste the JSON below verbatim. This allows `GET` and `HEAD` from production (`app.opsapp.co`), Vercel previews (`*.vercel.app`), and local development (`localhost:3000`, `localhost:3001`). `PUT`/`POST` are also allowed so presigned uploads from the same origins continue to work.

```json
[
  {
    "AllowedOrigins": [
      "https://app.opsapp.co",
      "https://*.vercel.app",
      "http://localhost:3000",
      "http://localhost:3001"
    ],
    "AllowedMethods": ["GET", "HEAD", "PUT", "POST"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

### 1.3 Save

Click **Save changes**. CORS updates propagate within a few seconds — no deploy, no cache bust needed.

---

## Part 2 — Verification

### 2.1 Curl preflight

From any terminal:

```bash
curl -i -X OPTIONS \
  -H "Origin: https://app.opsapp.co" \
  -H "Access-Control-Request-Method: GET" \
  "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/"
```

Expect the response headers to include:

```
access-control-allow-origin: https://app.opsapp.co
access-control-allow-methods: GET, HEAD, PUT, POST
access-control-max-age: 3000
```

If the response has **no** `access-control-*` headers, the CORS rule did not save — re-check Part 1.2 for JSON syntax errors (S3's editor is strict about trailing commas).

### 2.2 Browser verification (production)

1. Open https://app.opsapp.co/dashboard in an incognito window.
2. Open DevTools → **Network** tab → filter by `s3.us-west-2.amazonaws.com`.
3. Click any avatar that was previously broken.
4. Expected: request returns `200 OK` with `Access-Control-Allow-Origin: https://app.opsapp.co` in response headers.
5. Expected: no `CORS policy` or `net::ERR_FAILED` errors in Console tab.

### 2.3 Browser verification (Vercel preview)

Same steps on a recent preview URL (`https://ops-web-<branch>-<team>.vercel.app`). The wildcard `https://*.vercel.app` entry in Part 1.2 covers every preview deploy.

---

## Part 3 — Notes on scope

### Why both `GET`/`HEAD` and `PUT`/`POST`?

The bug report's suggested JSON only listed `GET` and `HEAD` since the symptom is read-side (avatar fetch). But the same bucket also handles profile-image **uploads** via presigned URLs. If we only allow reads, a future upload flow from the web app would hit a CORS wall on the `PUT`. Including `PUT`/`POST` now prevents a second runbook in three weeks. Presigned URLs still enforce authorization at the S3 level — CORS only controls which origins the browser permits the request from.

### Why `localhost:3000` and `:3001`?

Local dev mode hits the real production S3 bucket (we don't run a separate MinIO locally). Without these entries, `pnpm dev` sessions would see the same CORS errors as prod did. Port `3001` is included because `next dev` auto-bumps to the next free port when 3000 is taken.

### Why not restrict `AllowedHeaders` further?

S3's preflight response echoes whatever the browser requests in `Access-Control-Request-Headers`. TanStack Query, fetch polyfills, and Chrome itself send varying sets of headers (`if-none-match`, `range`, etc.). `["*"]` is the simplest correct answer — AWS recommends this for the common browser-read case. Lock down only if an audit requires it.

### Why `MaxAgeSeconds: 3000`?

50 minutes — browsers cache the preflight response and skip the `OPTIONS` round-trip on subsequent requests. Lower values waste bandwidth; higher values make CORS rule changes propagate slowly. 3000 matches AWS's own documentation examples and is the same value other OPS buckets use.

---

## Part 4 — Post-fix

- Close bug `ebc06dc2-3af4-4e0e-b14b-af3e73746496` with `status='resolved'` and `resolution_notes` pointing at this runbook.
- If we add a new front-end origin (e.g. `opsapp.co` without `app.` subdomain, or a white-label domain), append it to `AllowedOrigins` and repeat Part 2.1.
- When the S3 image migration memory note (`project_s3_image_migration.md`) becomes obsolete — i.e. all buckets migrated and CORS configured — delete or archive it.
