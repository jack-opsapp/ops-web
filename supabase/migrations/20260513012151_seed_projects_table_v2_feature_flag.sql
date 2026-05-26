begin;

insert into public.feature_flags (
  slug,
  label,
  description,
  enabled,
  routes,
  permissions
)
values (
  'projects_table_v2',
  'Projects Table V2',
  'Read-only virtualized Projects spreadsheet redesign.',
  false,
  array[]::text[],
  array[]::text[]
)
on conflict (slug) do update
set
  label = excluded.label,
  description = excluded.description,
  routes = excluded.routes,
  permissions = excluded.permissions,
  updated_at = now();

commit;
