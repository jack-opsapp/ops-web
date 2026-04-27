# SendGrid Sender Authentication — Operator Setup

Four sender identities, each on `opsapp.co` with full SPF / DKIM / DMARC alignment.
Until DNS is aligned, the typed `sendXxx` helpers in `src/lib/email/sendgrid.tsx`
fall back to `SENDGRID_FROM_EMAIL` (`noreply@opsapp.co`).

## Bucket map

| Bucket | Address | Purpose |
|--------|---------|---------|
| DISPATCH | `dispatch@opsapp.co` | Product, team, beta, trial, billing, ads briefing |
| GATE | `gate@opsapp.co` | Security, auth, password, email verification |
| FIELD_NOTES | `field@opsapp.co` | Newsletter, long-form content |
| PORTAL | per-company name + `SENDGRID_FROM_EMAIL` | Whitelabel portal emails |

## Step 1 — verified sender identities (SendGrid Console)

`Settings → Sender Authentication → Single Sender Verification → add`:

| Email | Name |
|-------|------|
| `dispatch@opsapp.co` | OPS Dispatch |
| `gate@opsapp.co` | OPS Gate |
| `field@opsapp.co` | OPS Field Notes |
| `info@opsapp.co` | OPS LTD. (used by portal whitelabel as fallback) |

Each requires an inbox SendGrid can deliver a verification email to. Use a
forwarding rule to your operator inbox.

## Step 2 — domain authentication (SendGrid Console)

`Settings → Sender Authentication → Authenticate Your Domain → opsapp.co`.

This generates 3 CNAME records that prove SendGrid can sign mail as
`opsapp.co`. Add them to Cloudflare:

```
em1234.opsapp.co              CNAME  u123.wl456.sendgrid.net
s1._domainkey.opsapp.co       CNAME  s1.domainkey.u123.wl456.sendgrid.net
s2._domainkey.opsapp.co       CNAME  s2.domainkey.u123.wl456.sendgrid.net
```

(Exact values come from SendGrid's UI — copy them verbatim. The `em####`
subdomain and `u###/wl###` identifiers are unique per SendGrid account.)

Wait 30 minutes, then click `Verify` in SendGrid.

## Step 3 — SPF + DMARC

Cloudflare DNS → `opsapp.co`. Add or update:

```
opsapp.co.           TXT   "v=spf1 include:sendgrid.net include:_spf.google.com ~all"
_dmarc.opsapp.co.    TXT   "v=DMARC1; p=quarantine; rua=mailto:dmarc@opsapp.co; ruf=mailto:dmarc@opsapp.co; fo=1; adkim=s; aspf=s"
```

If a `v=spf1` record already exists, **merge** — never duplicate. SPF allows
only one record per domain.

DMARC starts at `p=quarantine` for safety. After 2 weeks of clean reports
(zero `fail`s in the `rua` mailbox), tighten to `p=reject`.

## Step 4 — verify in production

```bash
# SPF
dig +short TXT opsapp.co | grep spf1

# DKIM (must NOT be empty)
dig +short CNAME s1._domainkey.opsapp.co

# DMARC
dig +short TXT _dmarc.opsapp.co
```

Send a test from each bucket via the admin send-test endpoint (added in PR 7).
Inspect the delivered email's headers — `Authentication-Results` should show
`spf=pass dkim=pass dmarc=pass`.

## Feature flags

| Var | Default | Purpose |
|-----|---------|---------|
| `EMAIL_PMF_NEW_TEMPLATES` | `false` | Re-render PMF threshold/daily/weekly emails through OPS layout primitives. Set `true` in staging during the bake; flip in production after a one-week soak with no regressions. |

## Rollback

If a typed sender bucket fails to deliver:

1. Each `sendXxx` function falls back to `SENDGRID_FROM_EMAIL` if its bucket
   address is not yet verified — sends still work, just from
   `noreply@opsapp.co` rather than the bucket.
2. To force fallback for a specific bucket: unset its verification in the
   SendGrid Console.
3. To roll back the entire bucket system: revert the typed sender migrations
   from PR β. The legacy `sendgrid.ts` and the `templates/` directory are
   preserved in git history.
4. To roll back PMF re-render only: unset `EMAIL_PMF_NEW_TEMPLATES`. Legacy
   PMF templates ship instantly with no redeploy required.
