begin;

revoke all on table public.qbo_item_product_mappings from anon, authenticated;
grant select on table public.qbo_item_product_mappings to authenticated;
grant all on table public.qbo_item_product_mappings to service_role;

do $$
begin
  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'qbo_item_product_mappings'
      and grantee = 'authenticated'
      and privilege_type <> 'SELECT'
  ) then
    raise exception 'qbo_item_product_mapping_acl_sentinel: authenticated write grant remains';
  end if;
end $$;

commit;
