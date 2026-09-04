# Sage sandbox war game

This runner is destructive by design, but only inside one explicitly allow-listed Sage test business and one exact OPS sandbox company. It creates a uniquely tagged accounting graph, exercises refresh/replay/update/reallocation/pull behavior, then voids or deletes only the provider objects it recorded and deletes only the exact OPS UUIDs in its run manifest.

It must never be pointed at a production Sage business or an ordinary customer company.

## Release boundary

The runner depends on the three Sage hardening migrations, including `apply_sage_reconcile_entity`. At the time this runbook was written, those migrations were locally proven but not applied to production. A real test-business run remains blocked until the target sandbox database has the connector schema and a dedicated Sage sandbox connection.

Sage does not provide a separate API hostname for test businesses. `SAGE_ACTIVE_PROFILE=sandbox`, dedicated OAuth credentials, the exact business allow-list, and the OPS connection binding form the sandbox boundary. Every business API request still uses the documented `https://api.accounting.sage.com/v3.1` origin with an explicit `X-Business` header.

## Required configuration

All fields are mandatory except `SAGE_SANDBOX_MANIFEST_DIR`.

```text
SAGE_ACTIVE_PROFILE=sandbox
ACCOUNTING_WRITE_ENABLED=true
SAGE_WRITE_ENABLED=true
QB_TOKEN_ENC_KEY=<base64 exact 32-byte accounting token key>

SAGE_SANDBOX_CLIENT_ID=<dedicated test app client id>
SAGE_SANDBOX_CLIENT_SECRET=<dedicated test app client secret>
SAGE_SANDBOX_REDIRECT_URI=<https URL or localhost callback>
SAGE_SANDBOX_REFRESH_TOKEN=<renewable test-business refresh token>
SAGE_SANDBOX_BUSINESS_ID=<one exact test business id>
SAGE_SANDBOX_BUSINESS_IDS=<comma-separated allow-list containing that exact id>

SAGE_SANDBOX_OPS_COMPANY_ID=<dedicated OPS sandbox company UUID>
SAGE_SANDBOX_OPS_CONNECTION_ID=<its exact connected Sage UUID>
SAGE_SANDBOX_OPS_USER_ID=<operator UUID in that company>
SAGE_SANDBOX_OPS_EXPENSE_CATEGORY_ID=<expense category UUID in that company>

SAGE_SANDBOX_LEDGER_ACCOUNT_ID=<valid Sage sales and purchase ledger account id>
SAGE_SANDBOX_TAX_RATE_ID=<valid Sage tax rate id>
SAGE_SANDBOX_BANK_ACCOUNT_ID=<valid Sage bank account id>
SAGE_SANDBOX_PAYMENT_METHOD_ID=<valid Sage payment method id>

NEXT_PUBLIC_SUPABASE_URL=<OPS sandbox database URL>
SUPABASE_SERVICE_ROLE_KEY=<OPS sandbox service-role key>
SAGE_SANDBOX_MANIFEST_DIR=/private/tmp/ops-sage-sandbox-war-game
```

The sandbox client id and secret must be distinct from any configured production Sage credentials. The selected business must exactly match both `SAGE_SANDBOX_BUSINESS_IDS` and the SHA-256 binding on the stated OPS connection. The connection must be active and sync-enabled. The operator, expense category, and both AR/AP payment mappings must already belong to that same company and connection.

## Run

From `ops-web`:

```bash
npm run sage:sandbox:war-game
```

The package command supplies Node's `react-server` export condition so the
standalone operator process can load the same server-only modules used by the
Next.js runtime. Do not replace it with a bare `tsx` invocation.

Exit codes:

- `0`: graph, readback, pull reconciliation, and cleanup all passed.
- `1`: a provider, reconciliation, readback, or cleanup assertion failed.
- `2`: strict preflight returned `BLOCKED` before any provider request.

The runner intentionally sends an invalid disposable access token on the first business-bound request. The expected 401 must rotate the refresh token and replay the same idempotent write. The resulting rotating refresh token remains memory-only; the runner never prints or persists it.

## Proof manifest

Successful and failed real runs write a mode-`0600` redacted JSON manifest to `SAGE_SANDBOX_MANIFEST_DIR`. The manifest contains:

- one UUID-v4 run id;
- exact Sage business, OPS company, and OPS connection identities;
- exact OPS entity UUIDs and external ids grouped by resource;
- accepted-write timestamps and safe `x-request-id` evidence;
- pull readback timestamps;
- provider terminal-state readback and an exact OPS remaining-row count.

Access tokens, refresh tokens, client secrets, service-role keys, authorization headers, raw provider bodies, and payloads are excluded recursively. Move a useful reviewed manifest into `docs/artifacts/sage-sandbox-war-game/` only when it is needed as durable proof; never commit it.

## Cleanup response

Cleanup runs in `finally` and proceeds in reverse dependency order: contact payments, purchase invoices, sales invoices, quotes, estimates, then contacts. OPS sync is disabled only while the runner seeds or removes its exact fixture rows and is restored before pull reconciliation and again at exit.

If any provider object remains active, any exact OPS row remains, or the original sync state cannot be restored, the result is `failed` with cleanup status `manual_required`. Use only the recorded manifest ids for manual cleanup. Do not broaden a delete filter, delete by tag alone, or run cleanup against another company or business.

## Provider references

- [Sage authentication](https://developer.sage.com/accounting/docs/v1.0.0/guides/learning/authenticating/authentication)
- [Sage API best practices](https://developer.sage.com/accounting/docs/v1.0.0/guides/learning/key-concepts/best-practices)
- [Sage idempotency](https://developer.sage.com/accounting/docs/v1.0.0/guides/learning/key-concepts/idempotency)
- [Sage Accounting API v3.1](https://developer.sage.com/accounting/apis/sagebusinesscloudaccounting/3.1.0/accounting)
