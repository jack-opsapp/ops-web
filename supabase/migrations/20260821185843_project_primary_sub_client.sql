begin;

-- One explicit primary contact per project.
--
-- Existing projects remain unchanged: the new FK is nullable and starts NULL.
-- Project writes keep their existing row-level projects.edit policy. Private,
-- search-path-hardened triggers enforce relationship integrity and clean up a
-- selection when an older client changes the project client without knowing
-- about this new field, or when the selected sub-client is deleted/reparented.

alter table public.projects
  add column if not exists primary_sub_client_id uuid;

do $constraint$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.projects'::regclass
       and conname = 'projects_primary_sub_client_id_fkey'
  ) then
    alter table public.projects
      add constraint projects_primary_sub_client_id_fkey
      foreign key (primary_sub_client_id)
      references public.sub_clients(id)
      on delete set null;
  end if;
end;
$constraint$;

create index if not exists projects_primary_sub_client_id_idx
  on public.projects (primary_sub_client_id)
  where primary_sub_client_id is not null;

comment on column public.projects.primary_sub_client_id is
  'Explicit active sub-client used as this project contact; NULL uses the parent client.';

create or replace function private.validate_project_primary_sub_client()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  -- Compatibility fence: an installed client that only changes client_id has
  -- no knowledge of primary_sub_client_id. Carrying the old contact across to
  -- a different client would make that ordinary update fail, so clear it. A
  -- newer caller may still change both fields atomically to a valid new pair.
  if tg_op = 'UPDATE'
     and (
       new.client_id is distinct from old.client_id
       or new.company_id is distinct from old.company_id
     )
     and new.primary_sub_client_id is not distinct from old.primary_sub_client_id
  then
    new.primary_sub_client_id := null;
  end if;

  if new.primary_sub_client_id is null then
    return new;
  end if;

  if not exists (
    select 1
      from public.sub_clients sub_client
     where sub_client.id = new.primary_sub_client_id
       and sub_client.client_id = new.client_id
       and sub_client.company_id = new.company_id
       and sub_client.deleted_at is null
  ) then
    raise exception 'project primary contact must be an active sub-client of the selected client'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function private.validate_project_primary_sub_client() from public, anon, authenticated;

drop trigger if exists projects_validate_primary_sub_client on public.projects;
create trigger projects_validate_primary_sub_client
before insert or update of primary_sub_client_id, client_id, company_id
on public.projects
for each row
execute function private.validate_project_primary_sub_client();

create or replace function private.clear_invalid_project_primary_sub_client()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
begin
  if new.deleted_at is not null
     or new.client_id is distinct from old.client_id
     or new.company_id is distinct from old.company_id
  then
    update public.projects project
       set primary_sub_client_id = null
     where project.primary_sub_client_id = new.id
       and (
         new.deleted_at is not null
         or project.client_id is distinct from new.client_id
         or project.company_id is distinct from new.company_id
       );
  end if;

  return new;
end;
$function$;

revoke all on function private.clear_invalid_project_primary_sub_client() from public, anon, authenticated;

drop trigger if exists sub_clients_clear_invalid_project_primary_contact
  on public.sub_clients;
create trigger sub_clients_clear_invalid_project_primary_contact
after update of deleted_at, client_id, company_id
on public.sub_clients
for each row
execute function private.clear_invalid_project_primary_sub_client();

do $sentinel$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'projects'
       and column_name = 'primary_sub_client_id'
       and is_nullable = 'YES'
       and udt_name = 'uuid'
  ) then
    raise exception 'project primary sub-client sentinel failed: nullable UUID column missing';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.projects'::regclass
       and conname = 'projects_primary_sub_client_id_fkey'
       and contype = 'f'
  ) then
    raise exception 'project primary sub-client sentinel failed: FK missing';
  end if;
end;
$sentinel$;

commit;
