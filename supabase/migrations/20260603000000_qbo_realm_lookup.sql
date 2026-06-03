begin;

-- ============================================================================
-- QuickBooks Online — realm routing lookup column
--
-- Inbound Intuit webhooks (Customer/Invoice/Payment/Estimate change events)
-- carry a PLAINTEXT `realmId` (the opaque QBO company id) and must route to the
-- owning `accounting_connections` row. But `accounting_connections.realm_id` is
-- AES-256-GCM encrypted at rest with a fresh random IV per write (token-cipher),
-- so the ciphertext is non-deterministic and CANNOT be matched with a WHERE
-- clause — two encryptions of the same realm id never compare equal.
--
-- This adds a deterministic, non-reversible routing column:
--   realm_id_lookup = lower(hex(sha256(realmId)))   -- token-cipher.realmIdLookup
-- written alongside the encrypted realm_id by the OAuth callback. The webhook
-- receiver hashes the inbound realmId the same way and selects the connection by
-- realm_id_lookup. SHA-256 (no salt) is sufficient: the realm id is an opaque
-- company id used only for routing, not a secret credential.
--
-- Purely ADDITIVE (iOS-sync-safe): one new nullable column + one new index.
-- Nothing is altered, dropped, or retyped, so existing iOS App Store releases
-- continue to read the table unchanged. Fully idempotent (IF NOT EXISTS), so
-- re-running is a no-op. Created inside the migration transaction (NOT
-- CONCURRENTLY) to match repo convention; the table is tiny (one row per
-- connected company) so the brief lock is fine.
-- ============================================================================

alter table public.accounting_connections
  add column if not exists realm_id_lookup text;

comment on column public.accounting_connections.realm_id_lookup is
  'Deterministic SHA-256 hex of the plaintext QBO realmId. Routing key for inbound Intuit webhooks (realm_id itself is AES-encrypted and unqueryable). Set by the OAuth callback via token-cipher.realmIdLookup().';

create index if not exists idx_accounting_connections_realm_lookup
  on public.accounting_connections (realm_id_lookup);

-- ── sentinel rollback guard ──────────────────────────────────────────────────
-- Re-verify the column and its index both exist before commit. Either one
-- missing RAISEs, aborting the transaction so a half-applied state cannot land.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'accounting_connections'
      and column_name = 'realm_id_lookup'
  ) then
    raise exception 'qbo_realm_lookup_sentinel: column public.accounting_connections.realm_id_lookup missing';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'idx_accounting_connections_realm_lookup'
      and c.relkind = 'i'
  ) then
    raise exception 'qbo_realm_lookup_sentinel: index public.idx_accounting_connections_realm_lookup missing';
  end if;
end$$;

commit;
