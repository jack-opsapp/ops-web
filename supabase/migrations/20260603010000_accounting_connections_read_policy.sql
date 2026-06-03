begin;

-- ============================================================================
-- accounting_connections — anon read policy for connection STATUS
--
-- Bug (eb70d803): accounting_connections had ONLY a `service_role` RLS policy.
-- The web client reads the table directly as the anon role (Firebase-bridged
-- identity via private.get_current_user_id() / get_user_company_id()), so
-- AccountingService.getConnections returned ZERO rows — a completed QuickBooks
-- OAuth connect (is_connected=true) showed as NOT CONNECTED in the UI forever,
-- even after a hard refresh.
--
-- This adds a company-scoped, accounting.view-gated SELECT policy for the anon
-- role, mirroring the qbo_* tables. It is read-only and safe:
--   • OAuth secrets (access_token/refresh_token) and realm_id are AES-encrypted
--     at rest — a client read only ever yields ciphertext (the key is a
--     server-only env var), and AccountingService.getConnections selects only
--     non-secret columns.
--   • WRITES remain service-role-only (no anon write policy is added). The
--     existing `service_role_only` ALL policy is unchanged.
--
-- company_id on this table is TEXT, so the uuid from get_user_company_id() is
-- cast to text for the comparison. Idempotent (grant + drop-if-exists + create).
--
-- NOTE: this policy was hotfixed directly onto prod on 2026-06-03; this
-- migration brings the repo in sync (no drift). Re-running is a no-op.
-- ============================================================================

grant select on table public.accounting_connections to authenticated, anon;

drop policy if exists "read company accounting_connections with accounting view"
  on public.accounting_connections;

create policy "read company accounting_connections with accounting view"
on public.accounting_connections for select
using (
  company_id = (select private.get_user_company_id())::text
  and public.has_permission((select private.get_current_user_id()), 'accounting.view', 'all')
);

-- ── sentinel rollback guard ──────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    where c.relname = 'accounting_connections'
      and p.polname = 'read company accounting_connections with accounting view'
  ) then
    raise exception 'sentinel: accounting_connections read policy missing';
  end if;
end$$;

commit;
