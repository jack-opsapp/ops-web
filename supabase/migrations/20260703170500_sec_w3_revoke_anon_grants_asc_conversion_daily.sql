-- W3 security posture sweep (follow-up, discovered during post-apply verification)
-- — revoke anon/authenticated grants on the asc_conversion_daily view.
--
-- asc_conversion_daily is a security_invoker VIEW over the asc_* App Store Connect
-- base tables, granted directly to anon+authenticated. Before this sweep it was
-- anon-readable (anon held grants on both the view and its base tables). Migration
-- 20260703170300 (revoking the base-table grants) already closed the read path — a
-- security_invoker view evaluates the caller's privileges against the underlying
-- tables — so anon can no longer read it. This removes the now-vestigial direct
-- grants on the view for consistency. The operator App Store dashboard reads via
-- getAdminSupabase() / service_role (lib/admin/app-store-queries.ts); there is no
-- anon-bridge or iOS caller.
--
-- The seven other anon-granted security_invoker views (inventory_item_tags,
-- inventory_items, inventory_snapshot_items, inventory_snapshots, inventory_tags,
-- inventory_units, project_table_rows) are intentional product views — their
-- security_invoker setting enforces company isolation through the base tables — and
-- are deliberately left in place.

begin;

revoke all on public.asc_conversion_daily from anon, authenticated;

do $do$
declare v_bad int;
begin
  select count(*) into v_bad
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'asc_conversion_daily'
    and grantee in ('anon', 'authenticated');
  if v_bad <> 0 then
    raise exception 'sec_w3_asc_view_sentinel: % residual anon/authenticated grant(s) on asc_conversion_daily', v_bad;
  end if;
end
$do$;

commit;
