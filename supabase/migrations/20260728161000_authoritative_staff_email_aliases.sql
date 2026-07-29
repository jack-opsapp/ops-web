-- Authoritative, auditable secondary email identity for active OPS team members.
-- Pending signature evidence blocks false lead creation but never grants exact
-- operator identity until an administrator explicitly verifies the alias.

begin;

create table public.user_email_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'rejected')),
  source text not null
    check (source in (
      'signature_corroborated',
      'operator_verified'
    )),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  verified_at timestamptz,
  verified_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_email_aliases_user_company_fkey
    foreign key (company_id, user_id)
    references public.users (company_id, id)
    on delete cascade,
  constraint user_email_aliases_reviewer_company_fkey
    foreign key (company_id, reviewed_by)
    references public.users (company_id, id)
    on delete restrict,
  constraint user_email_aliases_verifier_company_fkey
    foreign key (company_id, verified_by)
    references public.users (company_id, id)
    on delete restrict,
  constraint user_email_aliases_normalized_email
    check (
      email = lower(btrim(email))
      and email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$'
    ),
  constraint user_email_aliases_review_audit
    check (
      (
        status = 'pending'
        and source = 'signature_corroborated'
        and reviewed_at is null
        and reviewed_by is null
        and verified_at is null
        and verified_by is null
      )
      or (
        status = 'verified'
        and source = 'operator_verified'
        and reviewed_at is not null
        and reviewed_by is not null
        and verified_at is not distinct from reviewed_at
        and verified_by is not distinct from reviewed_by
      )
      or (
        status = 'rejected'
        and source = 'signature_corroborated'
        and reviewed_at is not null
        and reviewed_by is not null
        and verified_at is null
        and verified_by is null
      )
    ),
  unique (company_id, email)
);

create index user_email_aliases_user_status_idx
  on public.user_email_aliases (company_id, user_id, status, email);
create index user_email_aliases_reviewed_by_idx
  on public.user_email_aliases (company_id, reviewed_by)
  where reviewed_by is not null;
create index user_email_aliases_verified_by_idx
  on public.user_email_aliases (company_id, verified_by)
  where verified_by is not null;

alter table public.user_email_aliases enable row level security;

revoke all on table public.user_email_aliases
  from public, anon, authenticated, service_role;
grant select on table public.user_email_aliases to authenticated, service_role;

create policy user_email_aliases_admin_read
  on public.user_email_aliases
  for select
  to authenticated
  using (
    company_id = (select private.get_user_company_id())
    and private.permission_user_is_admin(
      (select private.get_current_user_id()),
      company_id
    )
  );

create or replace function private.guard_user_email_alias_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.company_id is distinct from old.company_id
    or new.user_id is distinct from old.user_id
    or new.email is distinct from old.email
    or new.first_seen_at is distinct from old.first_seen_at
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'staff alias identity is immutable'
      using errcode = '22023';
  end if;

  if tg_op = 'UPDATE'
    and old.status <> 'pending'
    and (
      new.status is distinct from old.status
      or new.source is distinct from old.source
      or new.evidence is distinct from old.evidence
      or new.reviewed_at is distinct from old.reviewed_at
      or new.reviewed_by is distinct from old.reviewed_by
      or new.verified_at is distinct from old.verified_at
      or new.verified_by is distinct from old.verified_by
    )
  then
    raise exception 'staff alias review is immutable'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.users app_user
     where app_user.id = new.user_id
       and app_user.company_id = new.company_id
       and app_user.is_active is true
       and app_user.deleted_at is null
  ) then
    raise exception 'staff alias user is not an active company member'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.users registered
     where registered.company_id = new.company_id
       and lower(btrim(registered.email)) = new.email
       and registered.id <> new.user_id
       and registered.deleted_at is null
  ) then
    raise exception 'staff alias belongs to another registered user'
      using errcode = '23505';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function private.guard_user_email_alias_identity()
  from public, anon, authenticated, service_role;

create trigger user_email_aliases_guard_identity
  before insert or update on public.user_email_aliases
  for each row execute function private.guard_user_email_alias_identity();

create or replace function public.record_staff_email_alias_candidate_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_user_id uuid,
  p_email text,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_evidence jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user public.users%rowtype;
  v_expected_name text;
  v_expected_phone text;
  v_alias public.user_email_aliases%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null
    or p_connection_id is null
    or p_user_id is null
    or v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$'
    or nullif(btrim(p_provider_thread_id), '') is null
    or nullif(btrim(p_provider_message_id), '') is null
    or jsonb_typeof(p_evidence) is distinct from 'object'
    or not (
      p_evidence ?& array[
        'fullName',
        'phone',
        'registeredEmailRecipient'
      ]
      and p_evidence - array[
        'fullName',
        'phone',
        'registeredEmailRecipient'
      ]::text[] = '{}'::jsonb
      and jsonb_typeof(p_evidence -> 'registeredEmailRecipient') = 'boolean'
    )
  then
    raise exception 'invalid staff alias candidate input'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
      from public.email_connections connection
     where connection.id = p_connection_id
       and connection.company_id = p_company_id::text
       and connection.status = 'active'
       and connection.sync_enabled is true
  ) then
    raise exception 'staff alias mailbox is not active'
      using errcode = '42501';
  end if;

  select *
    into v_user
    from public.users app_user
   where app_user.id = p_user_id
     and app_user.company_id = p_company_id
     and app_user.is_active is true
     and app_user.deleted_at is null;
  if not found then
    raise exception 'staff alias user is not active'
      using errcode = '42501';
  end if;

  v_expected_name := btrim(
    regexp_replace(
      lower(
        btrim(coalesce(v_user.first_name, '')) || ' ' ||
        btrim(coalesce(v_user.last_name, ''))
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
  v_expected_phone := regexp_replace(coalesce(v_user.phone, ''), '\D', '', 'g');
  if length(v_expected_phone) = 11 and left(v_expected_phone, 1) = '1' then
    v_expected_phone := right(v_expected_phone, 10);
  end if;

  if v_expected_name = ''
    or v_expected_name <> btrim(
      regexp_replace(
        lower(p_evidence ->> 'fullName'),
        '[^a-z0-9]+',
        ' ',
        'g'
      )
    )
    or length(v_expected_phone) < 10
    or v_expected_phone <> regexp_replace(
      p_evidence ->> 'phone',
      '\D',
      '',
      'g'
    )
  then
    raise exception 'staff alias candidate evidence does not match roster'
      using errcode = '42501';
  end if;

  if lower(btrim(v_user.email)) = v_email then
    raise exception 'registered staff email cannot be an alias candidate'
      using errcode = '22023';
  end if;

  insert into public.user_email_aliases (
    company_id,
    user_id,
    email,
    status,
    source,
    evidence
  ) values (
    p_company_id,
    p_user_id,
    v_email,
    'pending',
    'signature_corroborated',
    p_evidence || jsonb_build_object(
      'connection_id', p_connection_id,
      'provider_thread_id', btrim(p_provider_thread_id),
      'provider_message_id', btrim(p_provider_message_id)
    )
  )
  on conflict (company_id, email) do update
     set last_seen_at = now(),
         evidence = case
           when user_email_aliases.status = 'pending'
             and user_email_aliases.user_id = excluded.user_id
           then excluded.evidence
           else user_email_aliases.evidence
         end
  returning * into v_alias;

  if v_alias.user_id is distinct from p_user_id then
    raise exception 'staff alias is owned by another team member'
      using errcode = '23505';
  end if;
  return v_alias.id;
end;
$function$;

revoke all on function public.record_staff_email_alias_candidate_as_system(
  uuid, uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.record_staff_email_alias_candidate_as_system(
  uuid, uuid, uuid, text, text, text, jsonb
) to service_role;

create or replace function public.review_user_email_alias(
  p_alias_id uuid,
  p_status text
) returns public.user_email_aliases
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_alias public.user_email_aliases%rowtype;
  v_reviewed_at timestamptz := now();
begin
  if p_status not in ('verified', 'rejected') then
    raise exception 'invalid staff alias review status'
      using errcode = '22023';
  end if;

  select *
    into v_alias
    from public.user_email_aliases alias
   where alias.id = p_alias_id
   for update;
  if not found then
    raise exception 'staff_alias_not_found' using errcode = 'P0002';
  end if;
  if v_alias.company_id is distinct from private.get_user_company_id()
    or not private.permission_user_is_admin(
      v_actor_user_id,
      v_alias.company_id
    )
  then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if v_alias.status <> 'pending' then
    raise exception 'staff alias review is already final'
      using errcode = '22023';
  end if;

  update public.user_email_aliases
     set status = p_status,
         source = case
           when p_status = 'verified' then 'operator_verified'
           else source
         end,
         reviewed_at = v_reviewed_at,
         reviewed_by = v_actor_user_id,
         verified_at = case
           when p_status = 'verified' then v_reviewed_at
           else null
         end,
         verified_by = case
           when p_status = 'verified' then v_actor_user_id
           else null
         end,
         evidence = evidence || jsonb_build_object(
           'reviewed_at', v_reviewed_at,
           'reviewed_by', v_actor_user_id,
           'review_status', p_status
         )
   where id = p_alias_id
  returning * into v_alias;
  return v_alias;
end;
$function$;

revoke all on function public.review_user_email_alias(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.review_user_email_alias(uuid, text)
  to authenticated;

commit;
