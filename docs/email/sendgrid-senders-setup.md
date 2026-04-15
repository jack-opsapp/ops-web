# SendGrid Sender + DNS Setup

One-time setup for the three new OPS sender identities. Everything here is manual (SendGrid web UI + DNS provider UI) because SendGrid's verified-sender flow requires clicking a confirmation link in a real inbox.

## Senders to add

| Sender | Email | Display name | Reply-to |
|---|---|---|---|
| Dispatch | `dispatch@opsapp.co` | `OPS Dispatch` | `dispatch@opsapp.co` |
| Gate | `gate@opsapp.co` | `OPS Gate` | `gate@opsapp.co` |
| Field Notes | `field@opsapp.co` | `OPS Field Notes` | `field@opsapp.co` |

## SendGrid steps

1. Log into SendGrid console → **Settings → Sender Authentication → Single Sender Verification**.
2. Click **Create New Sender**.
3. For each sender:
   - **From Name:** per the table above
   - **From Email Address:** per the table above
   - **Reply To:** same as From Email
   - **Company Address:** `1515 Douglas St, Victoria, BC V8W 2G4, Canada`
   - **Nickname:** `OPS Dispatch`, `OPS Gate`, `OPS Field Notes` (for SendGrid UI only)
4. Click **Save**. SendGrid sends a verification email to the From address.
5. Each address must receive inbox for verification. If the `opsapp.co` MX is set up, the confirmation arrives at `dispatch@`, `gate@`, `field@`. Click the link.

## DNS records — Domain Authentication (preferred over Single Sender)

Single Sender Verification works but doesn't align SPF/DKIM. For production quality, do Domain Authentication instead:

1. SendGrid console → **Settings → Sender Authentication → Domain Authentication → Authenticate Your Domain**.
2. **Domain:** `opsapp.co`
3. **DNS host:** your provider (Namecheap, Cloudflare, etc.)
4. **Advanced settings:** leave default (automatic security).
5. SendGrid generates 3 CNAME records. Add them to the `opsapp.co` DNS zone via the DNS provider dashboard.
6. Wait for DNS propagation (usually 5-30 minutes).
7. Click **Verify** in SendGrid. Status should flip to green.

Once Domain Authentication is verified, SendGrid can send from ANY address on `opsapp.co` without per-sender verification. This is the preferred path.

## SPF record (manual — Domain Authentication handles automatically if using v3)

If Domain Authentication is configured, skip this step. Otherwise, add to the `opsapp.co` TXT record:

```
v=spf1 include:sendgrid.net -all
```

(If the current SPF record already exists, merge the `include:sendgrid.net` into it — do not create a second SPF record.)

## DMARC record (recommended)

Add a DMARC TXT record at `_dmarc.opsapp.co`:

```
v=DMARC1; p=quarantine; rua=mailto:postmaster@opsapp.co; pct=100
```

Adjust `p=` as policy matures: start with `p=none` for monitoring, move to `p=quarantine` after 1-2 weeks of clean reports, then `p=reject` once aligned.

## Verification after setup

Run from the OPS-Web repo:

```bash
cd OPS-Web
npx tsx scripts/email/test-send.ts password-reset j4ckson.sweet@gmail.com
```

Open the email in Gmail. View "show original" / "view source". Confirm:

1. `From:` header reads `OPS Gate <gate@opsapp.co>`
2. `DKIM-Signature:` header is present with `d=opsapp.co` (domain-authenticated) or `d=sendgrid.net` (single sender fallback)
3. Gmail's "Authentication-Results" shows `spf=pass` and `dkim=pass`
4. No "via sendgrid.net" disclaimer after the sender name — if present, DKIM alignment is not complete

## Cost

Zero. SendGrid free tier covers verified senders, domain authentication, and DKIM. The DNS records are free at every provider.
