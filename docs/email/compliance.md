# Email Compliance — CAN-SPAM + CASL

OPS sends commercial email to recipients in Canada (CASL) and the US
(CAN-SPAM). Both regimes require:

1. A clearly visible **physical postal address** in every email.
2. A **functioning unsubscribe** mechanism honoured within 10 business days
   (CAN-SPAM) — we honour immediately.
3. **Proof of consent** for marketing email (CASL).

OPS implements all three.

## Where the compliance footer lives

Every email rendered through `OpsEmailLayout` or `PortalEmailLayout` includes
a `<ComplianceFooter list={...} unsubscribeUrl={...} />` block at the bottom
of the body band, above the brand sign-off. The footer renders:

- `// OPS LTD.` eyebrow
- `1515 Douglas St, Victoria, BC V8W 2G4, Canada` (from
  `src/lib/email/constants.ts` → `OPS_PHYSICAL_ADDRESS`)
- A sentence: "You're receiving this because you subscribed to {LIST}.
  Unsubscribe or write us at support@opsapp.co."

The legal name + address are in `src/lib/email/constants.ts`. **If the
company moves, edit only that file; every email picks up the new address
automatically.**

## How the unsubscribe link works

The link points at `/api/email/unsubscribe?t=<TOKEN>`. The token is
HMAC-SHA256 over `email|list|expiresAt`, signed with
`EMAIL_UNSUBSCRIBE_SECRET`.

- **Manual click** → loads `/unsubscribe?t=...` → POSTs token (JSON) →
  confirms.
- **Gmail one-click** → POSTs `application/x-www-form-urlencoded` with
  `token=...` directly. Gmail uses the
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header (RFC 8058) to
  know one-click is supported.

Both paths land in the same `addSuppression()` call (PR 1).

The SMTP headers OPS injects on every send:

```
List-Unsubscribe: <https://app.opsapp.co/api/email/unsubscribe?t=...>, <mailto:support@opsapp.co?subject=unsubscribe>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

## Rotating the unsubscribe secret

If `EMAIL_UNSUBSCRIBE_SECRET` is compromised (or for periodic rotation):

1. Generate new: `openssl rand -hex 32`.
2. Update Vercel env var (Production + Preview + Development).
3. Redeploy.
4. **All existing tokens become invalid immediately.** Users with
   in-flight unsubscribe links will hit the "INVALID LINK" error UI and
   must email support to be removed manually.
5. (Optional) For a graceful rotation, deploy with both old + new secrets
   and verify against each — would require a code change to the verify
   path. Default rotation strategy is hard-cutover.

## CASL proof of consent

Every newsletter signup records:

- `newsletter_subscribers.consent_at` (timestamp)
- `newsletter_subscribers.consent_ip` (client IP)
- `newsletter_subscribers.consent_source`
  (`blog_signup` | `landing_page` | `onboarding` | `manual_admin` | `import`)

If we receive a CASL inquiry, query:

```sql
SELECT email, consent_at, consent_ip, consent_source
FROM newsletter_subscribers
WHERE email = '<inquirer email>';
```

Historical pre-2026-04 rows have `consent_at` backfilled to `subscribed_at`
and `consent_ip` / `consent_source` NULL. If pressed, attest that consent
was collected via the existing signup form (which has always required
explicit opt-in via the bound checkbox).

### Subscriber inserts live in ops-site

The newsletter signup form lives in the marketing site (`ops-site/`), not
in OPS-Web. The CASL columns added in migration 084 must be populated by
the ops-site routes:

- `ops-site/src/app/api/contact/route.ts`
- `ops-site/src/app/api/early-access/route.ts`
- `ops-site/src/app/api/newsletter/route.ts`

A parallel PR in `ops-site` extends each of these to record `consent_at`,
`consent_ip`, and `consent_source` on every insert. The migration in this
repo is forward-compatible: new columns are nullable, so old ops-site code
still works during the rollout window.

## Whitelabel portal compliance

Whitelabel portal emails (sent on behalf of the customer's company) must
carry the *customer's* physical address, not OPS's. The
`companies.physical_address` column (added in migration 085) feeds
`PortalEmailLayout`'s footer via the optional `companyPhysicalAddress`
prop.

If `companies.physical_address` is NULL for a company, the portal email
send falls back to the OPS address. **Operator action:** nudge the company
to fill in Settings → Company → Physical Address.

The portal sender APIs (`sendMagicLink`, `sendEstimateReady`,
`sendInvoiceReady`, `sendQuestionsReminder`) all accept an optional
`companyPhysicalAddress` parameter; the caller looks it up from
`companies` and passes it through.

## DMARC alignment

After 2 weeks of `p=quarantine` with zero `fail`s in the `rua` mailbox,
tighten to `p=reject`. See `docs/email/sendgrid-senders-setup.md` for the
DNS records.

## Testing the path end-to-end

1. Trigger any send (e.g. `sendPasswordReset`) to a known good address.
2. Inspect raw headers in the delivered email. Confirm both
   `List-Unsubscribe` and `List-Unsubscribe-Post` present.
3. Click the footer link → land on `/unsubscribe?t=...` → see success UI.
4. Verify in Supabase:

```sql
SELECT email, list, reason, source, created_at
FROM email_suppressions
WHERE email = '<recipient>'
ORDER BY created_at DESC;
```

Expected: row with `source = 'webhook'`, `reason = 'unsubscribe'` (or
`'group_unsubscribe'` for non-global lists), `metadata.via = 'unsubscribe_link'`.

5. Trigger another send to the same address. Expect `gatedSend` to skip
   it via the suppression check, log
   `email_log.status = 'suppression_skipped'`, and return without calling
   SendGrid.
