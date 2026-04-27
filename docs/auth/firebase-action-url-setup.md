# Firebase Auth Action URL — Operator Setup

When PR 0 ships, every Firebase email link must land on `https://opsapp.co/auth/action`.

## Firebase Console
1. Auth → Templates → for each (Password reset, Email verification, Email change), set **Action URL** = `https://opsapp.co/auth/action`.
2. Save.

## Verify
- Trigger a password reset from production. Inspect the email link.
- Expected URL prefix: `https://opsapp.co/auth/action?mode=resetPassword&oobCode=...`

## AASA propagation
Apple caches AASA ~24h. Verify after deploy:
```bash
curl -i https://opsapp.co/.well-known/apple-app-site-association
```
Expected: `200`, `Content-Type: application/json`, contains `/auth/action*` and `/open*`.

## Reference IDs
- App Store ID: `6746662078`
- Bundle ID: `co.opsapp.ops.OPS`
- Apple Team ID: `X47H96M34K`

## Emergency rollback
Revert the Firebase Console change (set Action URL to empty) — Firebase falls back to default page within ~5 min. Code rollback is the standard PR revert.
