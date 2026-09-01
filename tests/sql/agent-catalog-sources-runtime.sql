begin;

-- PostgreSQL 17 rollback-only proof for Task 18 catalogue sources.
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $$ begin
  create role authenticated;
exception when duplicate_object then
  null;
end $$;

do $catalog_contract$
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'runtime_requires_postgresql_17';
  end if;
  if pg_catalog.to_regprocedure(
       'private.bump_agent_catalog_source_revision()'
     ) is null then
    raise exception 'agent_catalog_sources_runtime_failed: function_missing';
  end if;
end;
$catalog_contract$;

insert into public.companies (id, name, currency_code) values
  ('c1800000-0000-4000-8000-000000000001', 'Catalogue alpha', 'CAD'),
  ('c1800000-0000-4000-8000-000000000002', 'Catalogue bravo', 'CAD');

create temporary table task18_source_baseline (
  company_id uuid primary key,
  source_revision bigint not null
);
insert into task18_source_baseline
select revision.company_id, revision.source_revision
from private.agent_read_domain_revisions revision
where revision.company_id in (
    'c1800000-0000-4000-8000-000000000001',
    'c1800000-0000-4000-8000-000000000002'
  )
  and revision.domain = 'catalog';

insert into public.catalog_categories (
  id, company_id, name, default_warning_threshold, default_critical_threshold
) values (
  'c1810000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'Decking', 12, 4
);
insert into public.catalog_units (
  id, company_id, display, abbreviation, dimension
) values (
  'c1820000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'Each', 'ea', 'count'
);
insert into public.catalog_items (
  id, company_id, category_id, default_unit_id, name, description,
  default_price, is_active
) values (
  'c1830000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'c1810000-0000-4000-8000-000000000001',
  'c1820000-0000-4000-8000-000000000001',
  '  Vinyl   board  ', 'Safe public description', 12.50, true
);
insert into public.catalog_variants (
  id, company_id, catalog_item_id, sku, quantity, unit_id,
  warning_threshold, critical_threshold, is_active
) values (
  'c1840000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'c1830000-0000-4000-8000-000000000001',
  'VINYL-RUNTIME', 10, 'c1820000-0000-4000-8000-000000000001',
  12, 4, true
);
insert into public.catalog_options (id, catalog_item_id, name, sort_order)
values (
  'c1850000-0000-4000-8000-000000000001',
  'c1830000-0000-4000-8000-000000000001', 'Colour', 0
);
insert into public.catalog_option_values (id, option_id, value, sort_order)
values (
  'c1860000-0000-4000-8000-000000000001',
  'c1850000-0000-4000-8000-000000000001', 'Slate', 0
);
insert into public.catalog_variant_option_values (
  id, variant_id, option_value_id
) values (
  'c1870000-0000-4000-8000-000000000001',
  'c1840000-0000-4000-8000-000000000001',
  'c1860000-0000-4000-8000-000000000001'
);
insert into public.catalog_tags (id, company_id, name)
values (
  'c1880000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001', '  Exterior   grade '
);
insert into public.catalog_item_tags (id, catalog_item_id, tag_id)
values (
  'c1890000-0000-4000-8000-000000000001',
  'c1830000-0000-4000-8000-000000000001',
  'c1880000-0000-4000-8000-000000000001'
);
insert into public.catalog_stock_units (
  id, company_id, catalog_variant_id, unit_kind, status, quantity_value,
  location, lot_code
) values (
  'c18a0000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'c1840000-0000-4000-8000-000000000001',
  'each', 'full', 10, 'Yard', 'LOT-18'
);
insert into public.catalog_supplier_cost_profiles (
  id, company_id, catalog_variant_id, profile_key, label, unit_cost,
  currency_code, is_default, created_at, updated_at
) values (
  'c18b0000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'c1840000-0000-4000-8000-000000000001',
  'runtime', 'Runtime supplier', 8.25, 'CAD', true,
  pg_catalog.statement_timestamp(), pg_catalog.statement_timestamp()
);
insert into public.products (
  id, company_id, name, linked_catalog_item_id, is_active
) values (
  'c18c0000-0000-4000-8000-000000000001',
  'c1800000-0000-4000-8000-000000000001',
  'Vinyl deck package', 'c1830000-0000-4000-8000-000000000001', true
);
insert into public.product_materials (
  id, product_id, catalog_item_id, catalog_variant_id, quantity_per_unit,
  unit_id
) values (
  'c18d0000-0000-4000-8000-000000000001',
  'c18c0000-0000-4000-8000-000000000001',
  null,
  'c1840000-0000-4000-8000-000000000001',
  2, 'c1820000-0000-4000-8000-000000000001'
);

do $every_projected_source_bumps$
declare
  v_before bigint;
  v_after bigint;
begin
  select source_revision into strict v_before
  from task18_source_baseline
  where company_id = 'c1800000-0000-4000-8000-000000000001';
  select source_revision into strict v_after
  from private.agent_read_domain_revisions
  where company_id = 'c1800000-0000-4000-8000-000000000001'
    and domain = 'catalog';
  if v_after < v_before + 13 then
    raise exception 'agent_catalog_sources_runtime_failed: every_projected_source_bumps';
  end if;
end;
$every_projected_source_bumps$;

create temporary table task18_before_irrelevant (value bigint not null);
insert into task18_before_irrelevant
select source_revision
from private.agent_read_domain_revisions
where company_id = 'c1800000-0000-4000-8000-000000000001'
  and domain = 'catalog';

update public.catalog_items
set notes = 'Private-only change'
where id = 'c1830000-0000-4000-8000-000000000001';

do $irrelevant_updates_do_not_bump$
begin
  if (
    select source_revision
    from private.agent_read_domain_revisions
    where company_id = 'c1800000-0000-4000-8000-000000000001'
      and domain = 'catalog'
  ) is distinct from (select value from task18_before_irrelevant) then
    raise exception 'agent_catalog_sources_runtime_failed: irrelevant_updates_do_not_bump';
  end if;
end;
$irrelevant_updates_do_not_bump$;

create temporary table task18_before_writer_dml (value bigint not null);
insert into task18_before_writer_dml
select source_revision
from private.agent_read_domain_revisions
where company_id = 'c1800000-0000-4000-8000-000000000001'
  and domain = 'catalog';

grant usage on schema public to authenticated;
grant select, update on public.catalog_items to authenticated;
set local role authenticated;
update public.catalog_items
set name = 'Vinyl board writer'
where id = 'c1830000-0000-4000-8000-000000000001';
reset role;

do $writer_role_dml$
begin
  if (
    select source_revision
    from private.agent_read_domain_revisions
    where company_id = 'c1800000-0000-4000-8000-000000000001'
      and domain = 'catalog'
  ) <= (select value from task18_before_writer_dml) then
    raise exception 'agent_catalog_sources_runtime_failed: writer_role_dml';
  end if;
end;
$writer_role_dml$;

create temporary table task18_before_move (
  company_id uuid primary key,
  value bigint not null
);
insert into task18_before_move
select revision.company_id, revision.source_revision
from private.agent_read_domain_revisions revision
where revision.company_id in (
    'c1800000-0000-4000-8000-000000000001',
    'c1800000-0000-4000-8000-000000000002'
  )
  and revision.domain = 'catalog';

update public.catalog_tags
set company_id = 'c1800000-0000-4000-8000-000000000002'
where id = 'c1880000-0000-4000-8000-000000000001';

do $old_and_new_company_fanout$
declare
  v_company_id uuid;
begin
  foreach v_company_id in array array[
    'c1800000-0000-4000-8000-000000000001'::uuid,
    'c1800000-0000-4000-8000-000000000002'::uuid
  ] loop
    if (
      select source_revision
      from private.agent_read_domain_revisions
      where company_id = v_company_id and domain = 'catalog'
    ) <= (
      select value from task18_before_move where company_id = v_company_id
    ) then
      raise exception 'agent_catalog_sources_runtime_failed: old_and_new_company_fanout';
    end if;
  end loop;
end;
$old_and_new_company_fanout$;

set local enable_seqscan = off;
do $explain_proof$
declare
  v_plan json;
begin
  execute $query$
    explain (format json)
    select item.id
    from public.catalog_items item
    where item.company_id = 'c1800000-0000-4000-8000-000000000001'
      and item.deleted_at is null
      and pg_catalog.lower(pg_catalog.regexp_replace(
            pg_catalog.btrim(item.name), '[[:space:]]+', ' ', 'g'
          )) = 'vinyl board'
  $query$ into v_plan;
  if v_plan::text not like '%idx_catalog_items_agent_normalized_name_v1%' then
    raise exception 'agent_catalog_sources_runtime_failed: normalized_family_index';
  end if;

  execute $query$
    explain (format json)
    select tag.id
    from public.catalog_tags tag
    where tag.company_id = 'c1800000-0000-4000-8000-000000000002'
      and tag.deleted_at is null
      and pg_catalog.lower(pg_catalog.regexp_replace(
            pg_catalog.btrim(tag.name), '[[:space:]]+', ' ', 'g'
          )) = 'exterior grade'
  $query$ into v_plan;
  if v_plan::text not like '%idx_catalog_tags_agent_normalized_name_v1%' then
    raise exception 'agent_catalog_sources_runtime_failed: normalized_tag_index';
  end if;

  execute $query$
    explain (format json)
    select profile.id
    from public.catalog_supplier_cost_profiles profile
    where profile.company_id = 'c1800000-0000-4000-8000-000000000001'
      and profile.catalog_variant_id = 'c1840000-0000-4000-8000-000000000001'
      and profile.deleted_at is null
    order by profile.is_default desc, profile.updated_at desc, profile.id
  $query$ into v_plan;
  if v_plan::text not like '%idx_catalog_supplier_cost_profiles_agent_current_v1%' then
    raise exception 'agent_catalog_sources_runtime_failed: current_cost_index';
  end if;
end;
$explain_proof$;

do $private_acl$
begin
  if exists (
    select 1
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) acl
    where function_row.oid = pg_catalog.to_regprocedure(
      'private.bump_agent_catalog_source_revision()'
    )::oid
      and acl.grantee <> function_row.proowner
  ) then
    raise exception 'agent_catalog_sources_runtime_failed: private_acl';
  end if;
end;
$private_acl$;

rollback;
