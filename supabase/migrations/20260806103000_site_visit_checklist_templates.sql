begin;

create or replace function private.site_visit_type_fields_valid(
  p_fields jsonb
) returns boolean
language sql
immutable
strict
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select case
    when jsonb_typeof(p_fields) <> 'array' then false
    else jsonb_array_length(p_fields) between 1 and 100
    and pg_column_size(p_fields) <= 131072
    and exists (
      select 1
        from jsonb_array_elements(p_fields) as field
       where not (field ? 'isVisible')
          or field -> 'isVisible' = 'true'::jsonb
    )
    and (
      select count(*) = count(distinct field ->> 'id')
        from jsonb_array_elements(p_fields) as field
    )
    and not exists (
      select 1
        from jsonb_array_elements(p_fields) as field
       where jsonb_typeof(field) <> 'object'
          or jsonb_typeof(field -> 'id') <> 'string'
          or char_length(field ->> 'id') not between 1 and 256
          or jsonb_typeof(field -> 'label') <> 'string'
          or char_length(field ->> 'label') not between 1 and 500
          or btrim(field ->> 'label') = ''
          or jsonb_typeof(field -> 'kind') <> 'string'
          or field ->> 'kind' not in (
            'checkbox',
            'yes_no_na',
            'short_text',
            'long_text',
            'measurement',
            'photo',
            'photo_markup',
            'deck_design'
          )
          or jsonb_typeof(field -> 'required') <> 'boolean'
          or jsonb_typeof(field -> 'sortOrder') <> 'number'
          or (field ? 'helpText' and field -> 'helpText' <> 'null'::jsonb
              and jsonb_typeof(field -> 'helpText') <> 'string')
          or (field ? 'helpText' and field -> 'helpText' <> 'null'::jsonb
              and char_length(field ->> 'helpText') > 2000)
          or (field ? 'isVisible'
              and jsonb_typeof(field -> 'isVisible') <> 'boolean')
    )
  end;
$function$;

revoke all on function private.site_visit_type_fields_valid(jsonb)
  from public, anon, authenticated, service_role;

create table public.site_visit_types (
  id text primary key
    constraint site_visit_types_id_length check (
      char_length(id) between 1 and 256
    ),
  company_id text not null
    constraint site_visit_types_company_id_length check (
      char_length(company_id) between 1 and 256
    ),
  slug text not null
    constraint site_visit_types_slug_length check (
      char_length(slug) between 1 and 128
    ),
  name text not null
    constraint site_visit_types_name_length check (
      char_length(name) between 1 and 120 and btrim(name) <> ''
    ),
  description_text text
    constraint site_visit_types_description_length check (
      description_text is null or char_length(description_text) <= 500
    ),
  is_system_template boolean not null default false,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  fields jsonb not null default '[]'::jsonb
    constraint site_visit_types_fields_valid check (
      private.site_visit_type_fields_valid(fields)
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index site_visit_types_active_company_slug_uidx
  on public.site_visit_types(company_id, slug)
  where deleted_at is null;

create unique index site_visit_types_active_company_default_uidx
  on public.site_visit_types(company_id)
  where deleted_at is null and is_default;

create index site_visit_types_active_company_order_idx
  on public.site_visit_types(company_id, sort_order, name)
  where deleted_at is null;

create trigger site_visit_types_set_updated_at
before update on public.site_visit_types
for each row execute function public.fn_set_updated_at();

alter table public.site_visit_types enable row level security;

create policy site_visit_types_company_select
  on public.site_visit_types
  for select to anon, authenticated
  using (
    company_id = (select private.get_user_company_id())::text
  );

create policy site_visit_types_company_insert
  on public.site_visit_types
  for insert to anon, authenticated
  with check (
    company_id = (select private.get_user_company_id())::text
    and (select private.current_user_has_permission(
      'settings.company',
      'own'
    ))
  );

create policy site_visit_types_company_update
  on public.site_visit_types
  for update to anon, authenticated
  using (
    company_id = (select private.get_user_company_id())::text
    and (select private.current_user_has_permission(
      'settings.company',
      'own'
    ))
  )
  with check (
    company_id = (select private.get_user_company_id())::text
    and (select private.current_user_has_permission(
      'settings.company',
      'own'
    ))
  );

revoke all on table public.site_visit_types
  from public, anon, authenticated;
grant select, insert, update on table public.site_visit_types
  to anon, authenticated;
grant select, insert, update, delete on table public.site_visit_types
  to service_role;

alter table public.site_visit_types replica identity full;

do $publication$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'site_visit_types'
  ) then
    alter publication supabase_realtime add table public.site_visit_types;
  end if;
end;
$publication$;

comment on table public.site_visit_types is
  'Company-wide reusable site-visit checklist templates. Visit answers remain immutable snapshots.';

commit;
