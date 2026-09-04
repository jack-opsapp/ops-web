do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

create table public.companies (
  id uuid primary key,
  name text not null,
  deleted_at timestamptz
);

create table public.users (
  id uuid primary key,
  company_id uuid references public.companies(id),
  first_name text not null,
  last_name text not null,
  is_active boolean default true,
  deleted_at timestamptz
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  company_id text not null,
  type text not null,
  title text not null,
  body text not null,
  is_read boolean not null default false,
  persistent boolean not null default false,
  action_url text,
  action_label text,
  dedupe_key text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index idx_notifications_unread_dedup
  on public.notifications (user_id, company_id, type, coalesce(dedupe_key, title))
  where is_read = false and resolved_at is null;

create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
