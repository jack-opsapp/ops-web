-- OPS email -> lead -> project repair review
--
-- REVIEW ARTIFACT ONLY. Run with psql, never through the Supabase migration
-- runner. The default path commits only session-local temporary staging, then
-- performs every public-schema discovery query in a READ ONLY transaction and
-- finishes with ROLLBACK.
--
-- Safe default:
--   psql "$DATABASE_URL" \
--     -f docs/backfills/2026-07-13-email-lead-project-repair-review.sql
--
-- Mutation rehearsal (still rolls back):
--   psql "$DATABASE_URL" -v apply=true \
--     -f docs/backfills/2026-07-13-email-lead-project-repair-review.sql
--
-- Durable apply requires ALL of the following:
--   1. edit this file/copy to a reviewed run artifact and add exact allowlist rows;
--   2. every row has approved=true, expected current values, reviewer, rationale;
--   3. pass BOTH -v apply=true and -v commit=true.
--
-- The script never guesses a link, creates a split target, or infers a Sandra
-- mapping from sender/subject/thread. Empty allowlists are deliberate.

\set ON_ERROR_STOP on

\if :{?apply}
\else
  \set apply false
\endif

\if :{?commit}
\else
  \set commit false
\endif

\echo 'OPS email/lead/project repair review'
\echo 'apply=' :apply ' commit=' :commit

-- PostgreSQL forbids CREATE TEMP TABLE after SET TRANSACTION READ ONLY. Build
-- the empty/session-local review staging first, commit only those temporary
-- objects, and start the public-data transaction below. No public table is read
-- or written in this staging transaction.
begin;

create temp table _repair_scope (
  company_id uuid primary key,
  connection_id uuid not null,
  connection_email text not null,
  company_domain text not null,
  sandra_opportunity_id uuid not null,
  known_operator_phone_digits text not null,
  started_at timestamptz not null default transaction_timestamp()
) on commit preserve rows;

insert into _repair_scope (
  company_id,
  connection_id,
  connection_email,
  company_domain,
  sandra_opportunity_id,
  known_operator_phone_digits
) values (
  'a612edc0-5c18-4c4d-af97-55b9410dd077',
  '5dd46f2b-a6b6-4a3d-9c5a-d660341f14a3',
  'canprojack@gmail.com',
  'canprodeckandrail.com',
  '63ae2578-d3bc-40c4-bcec-77c980b407ed',
  '2505388994'
);

-- ---------------------------------------------------------------------------
-- ALLOWLISTS. They are empty unless a reviewer deliberately adds exact rows.
-- ---------------------------------------------------------------------------

create temp table _project_repair_allowlist (
  project_id uuid primary key,
  opportunity_id uuid not null unique,
  expected_project_status text not null,
  expected_opportunity_stage text not null,
  expected_project_opportunity_ref uuid,
  expected_project_opportunity_id text,
  expected_opportunity_project_ref uuid,
  expected_opportunity_project_id uuid,
  set_won boolean not null default false,
  approved boolean not null default false,
  reviewer text not null,
  rationale text not null,
  check (length(btrim(reviewer)) > 0),
  check (length(btrim(rationale)) > 0)
) on commit preserve rows;

-- TEMPLATE ONLY. Copy actual values from the discovery result. Null means the
-- reviewer expects that mirror to be null; all comparisons are null-safe.
--
-- insert into _project_repair_allowlist values (
--   '<project_uuid>', '<opportunity_uuid>',
--   '<expected_project_status>', '<expected_opportunity_stage>',
--   null, -- replace only when the expected project.opportunity_ref is non-null
--   null, -- replace only when the expected project.opportunity_id is non-null
--   null, -- replace only when the expected opportunity.project_ref is non-null
--   null, -- replace only when the expected opportunity.project_id is non-null
--   true, true, '<reviewer>', '<evidence for exact relationship>'
-- );

create temp table _direction_repair_allowlist (
  activity_id uuid primary key,
  expected_opportunity_id uuid,
  expected_direction text not null check (expected_direction in ('inbound', 'outbound')),
  approved_direction text not null check (approved_direction in ('inbound', 'outbound')),
  expected_from_email text not null,
  expected_provider_message_id text not null,
  approved boolean not null default false,
  reviewer text not null,
  rationale text not null,
  check (expected_direction <> approved_direction),
  check (length(btrim(reviewer)) > 0),
  check (length(btrim(rationale)) > 0)
) on commit preserve rows;

-- insert into _direction_repair_allowlist values (
--   '<activity_uuid>', null, -- replace null when an opportunity is expected
--   'inbound', 'outbound', '<exact_from_email>', '<provider_message_id>',
--   true, '<reviewer>', '<message header/SENT evidence>'
-- );

create temp table _contact_repair_allowlist (
  entity_type text not null check (entity_type in ('opportunity', 'client')),
  entity_id uuid not null,
  field_name text not null check (
    field_name in ('contact_name', 'contact_email', 'contact_phone', 'contact_address')
  ),
  expected_value text,
  replacement_value text not null,
  provider_thread_id text,
  provider_message_id text,
  approved boolean not null default false,
  reviewer text not null,
  rationale text not null,
  primary key (entity_type, entity_id, field_name),
  check (length(btrim(replacement_value)) > 0),
  check (length(btrim(reviewer)) > 0),
  check (length(btrim(rationale)) > 0)
) on commit preserve rows;

-- insert into _contact_repair_allowlist values (
--   'opportunity', '<opportunity_uuid>', 'contact_phone',
--   '(250) 538-8994', '<verified_customer_phone>',
--   '<provider_thread_id>', '<provider_message_id>',
--   true, '<reviewer>', '<customer-authored evidence>'
-- );

create temp table _activity_move_allowlist (
  activity_id uuid primary key,
  source_opportunity_id uuid not null,
  expected_source_client_id uuid not null,
  target_opportunity_id uuid not null,
  expected_target_client_id uuid not null,
  expected_activity_client_id uuid,
  expected_suggested_client_id uuid,
  replacement_suggested_client_id uuid,
  expected_provider_thread_id text not null,
  expected_provider_message_id text not null,
  expected_target_source_thread_key text not null,
  approved boolean not null default false,
  reviewer text not null,
  rationale text not null,
  check (source_opportunity_id <> target_opportunity_id),
  check (length(btrim(reviewer)) > 0),
  check (length(btrim(rationale)) > 0)
) on commit preserve rows;

-- Sandra-style repair requires an ALREADY-CREATED, human-reviewed target
-- opportunity. This script never creates one.
--
-- insert into _activity_move_allowlist values (
--   '<activity_uuid>',
--   '63ae2578-d3bc-40c4-bcec-77c980b407ed',
--   '<reviewed_source_client_uuid>',
--   '<existing_reviewed_target_opportunity_uuid>',
--   '<reviewed_target_client_uuid>',
--   '<expected_current_activity_client_uuid>',
--   null, -- expected current suggested_client_id
--   null, -- replacement suggested_client_id; normally clear stale review state
--   '<raw_provider_thread_id>', '<provider_message_id>',
--   'email:gmail:5dd46f2b-a6b6-4a3d-9c5a-d660341f14a3:message:<provider_message_id>',
--   true, '<reviewer>', '<body/contact evidence for this exact message>'
-- );

create temp table _thread_link_delete_allowlist (
  opportunity_email_thread_id uuid primary key,
  expected_opportunity_id uuid not null,
  expected_thread_id text not null,
  expected_connection_id uuid not null,
  approved boolean not null default false,
  reviewer text not null,
  rationale text not null,
  check (length(btrim(reviewer)) > 0),
  check (length(btrim(rationale)) > 0)
) on commit preserve rows;

-- A raw thread link is deleted only when every message carried by that link has
-- been reviewed. Never delete it merely because one message moved.
--
-- insert into _thread_link_delete_allowlist values (
--   '<opportunity_email_threads_row_uuid>', '<expected_opportunity_uuid>',
--   '<raw_provider_thread_id>',
--   '5dd46f2b-a6b6-4a3d-9c5a-d660341f14a3',
--   true, '<reviewer>', '<proof that raw-thread inheritance is invalid>'
-- );

-- This COMMIT persists only this psql session's temporary tables and rows. It
-- cannot make a durable OPS data change.
commit;

begin;
set transaction isolation level repeatable read;
\if :apply
\else
  -- Every access to public data on the safe-default path is now protected by
  -- PostgreSQL's transaction-level read-only enforcement.
  set transaction read only;
\endif
set local lock_timeout = '5s';
set local statement_timeout = '90s';

do $scope_assert$
begin
  if not exists (
    select 1
      from public.email_connections ec
      join _repair_scope s
        on s.connection_id = ec.id
       and s.company_id = ec.company_id
     where lower(ec.email) = lower(s.connection_email)
  ) then
    raise exception 'scope mismatch: Canpro email connection was not found';
  end if;
end
$scope_assert$;

-- ---------------------------------------------------------------------------
-- READ-ONLY DISCOVERY
-- ---------------------------------------------------------------------------

\echo 'Known July 13 repaired examples (verification sentinels; not allowlisted)'
with known(project_id, opportunity_id, label) as (
  values
    (
      '8677bbc8-5165-44a5-92a9-0a488fd441d4'::uuid,
      '7aad24fd-9695-4d65-b273-1da4222f7fcd'::uuid,
      'Mark - repaired before July 13 readback'
    ),
    (
      '96071b65-80e8-4408-bf7f-09a920e4ec59'::uuid,
      'ca401715-f59c-48c1-ba1c-ba6928948dff'::uuid,
      'Derek - repaired before July 13 readback'
    )
)
select
  k.label,
  p.id as project_id,
  p.status as project_status,
  p.opportunity_ref as project_opportunity_ref,
  p.opportunity_id as project_opportunity_id,
  o.id as opportunity_id,
  o.stage as opportunity_stage,
  o.project_ref as opportunity_project_ref,
  o.project_id as opportunity_project_id,
  (
    p.opportunity_ref = o.id
    and p.opportunity_id = o.id::text
    and o.project_ref = p.id
    and o.project_id = p.id
    and o.stage = 'won'
  ) as four_links_and_won
from known k
left join public.projects p on p.id = k.project_id
left join public.opportunities o on o.id = k.opportunity_id;

\echo 'Project/opportunity mismatch candidates; no relationship is inferred'
with project_links as (
  select
    p.*,
    coalesce(
      p.opportunity_ref,
      case
        when btrim(coalesce(p.opportunity_id, '')) ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then p.opportunity_id::uuid
        else null
      end
    ) as resolvable_opportunity_id
  from public.projects p
  join _repair_scope s on s.company_id = p.company_id
  where p.deleted_at is null
    and replace(lower(p.status), ' ', '_') in (
      'accepted', 'in_progress', 'completed', 'closed'
    )
)
select
  p.id as project_id,
  p.status as project_status,
  p.opportunity_ref,
  p.opportunity_id,
  p.resolvable_opportunity_id,
  o.stage as opportunity_stage,
  o.project_ref,
  o.project_id,
  case
    when p.resolvable_opportunity_id is null then 'unlinked_no_inference'
    when o.id is null then 'link_target_missing_or_wrong_company'
    when p.opportunity_ref is distinct from o.id then 'project_uuid_mirror_mismatch'
    when p.opportunity_id is distinct from o.id::text then 'project_text_mirror_mismatch'
    when o.project_ref is distinct from p.id then 'opportunity_fk_mirror_mismatch'
    when o.project_id is distinct from p.id then 'opportunity_uuid_mirror_mismatch'
    when o.stage is distinct from 'won' then 'linked_but_not_won'
    else 'consistent'
  end as finding
from project_links p
left join public.opportunities o
  on o.id = p.resolvable_opportunity_id
 and o.company_id = p.company_id
 and o.deleted_at is null
where p.resolvable_opportunity_id is null
   or o.id is null
   or p.opportunity_ref is distinct from o.id
   or p.opportunity_id is distinct from o.id::text
   or o.project_ref is distinct from p.id
   or o.project_id is distinct from p.id
   or o.stage is distinct from 'won'
order by p.created_at, p.id;

\echo 'Operator-authored activities stored inbound (candidate discovery only)'
select
  lower(a.from_email) as from_email,
  count(*) as inbound_rows,
  count(distinct a.opportunity_id) as affected_opportunities,
  min(a.created_at) as first_seen,
  max(a.created_at) as last_seen
from public.activities a
join _repair_scope s on s.company_id = a.company_id
where a.type = 'email'
  and a.direction = 'inbound'
  and (
    lower(a.from_email) = lower(s.connection_email)
    or lower(split_part(a.from_email, '@', 2)) = lower(s.company_domain)
  )
group by lower(a.from_email)
order by inbound_rows desc, from_email;

\echo 'Known operator-phone, .con, and local-part-name contact candidates'
select
  o.id as opportunity_id,
  o.title,
  o.stage,
  o.contact_name,
  o.contact_email,
  o.contact_phone,
  case
    when regexp_replace(coalesce(o.contact_phone, ''), '[^0-9]', '', 'g') =
         s.known_operator_phone_digits
      then 'known_operator_phone'
    when lower(coalesce(o.contact_email, '')) like '%.con'
      then 'email_dot_con'
    when o.contact_email is not null
      and regexp_replace(lower(coalesce(o.contact_name, '')), '[^a-z0-9]', '', 'g') =
          regexp_replace(lower(split_part(o.contact_email, '@', 1)), '[^a-z0-9]', '', 'g')
      then 'name_matches_email_local_part'
    else 'other'
  end as candidate_reason
from public.opportunities o
join _repair_scope s on s.company_id = o.company_id
where o.deleted_at is null
  and (
    regexp_replace(coalesce(o.contact_phone, ''), '[^0-9]', '', 'g') =
      s.known_operator_phone_digits
    or lower(coalesce(o.contact_email, '')) like '%.con'
    or (
      o.contact_email is not null
      and regexp_replace(lower(coalesce(o.contact_name, '')), '[^a-z0-9]', '', 'g') =
          regexp_replace(lower(split_part(o.contact_email, '@', 1)), '[^a-z0-9]', '', 'g')
    )
  )
order by candidate_reason, o.created_at, o.id;

\echo 'Sandra activity groups; raw thread is evidence, not an automatic split key'
select
  a.email_thread_id,
  lower(a.from_email) as from_email,
  count(*) as activity_count,
  count(distinct a.email_message_id) as provider_message_count,
  min(a.created_at) as first_seen,
  max(a.created_at) as last_seen,
  array_agg(a.id order by a.created_at, a.id) as activity_ids
from public.activities a
join _repair_scope s
  on s.company_id = a.company_id
 and s.sandra_opportunity_id = a.opportunity_id
where a.type = 'email'
group by a.email_thread_id, lower(a.from_email)
order by first_seen, a.email_thread_id, from_email;

\echo 'Sandra raw thread links'
select oet.*
from public.opportunity_email_threads oet
join _repair_scope s on s.sandra_opportunity_id = oet.opportunity_id
order by oet.created_at, oet.id;

\echo 'Allowlist row counts'
select 'project' as repair_class, count(*) filter (where approved) as approved,
       count(*) as total from _project_repair_allowlist
union all
select 'direction', count(*) filter (where approved), count(*)
  from _direction_repair_allowlist
union all
select 'contact', count(*) filter (where approved), count(*)
  from _contact_repair_allowlist
union all
select 'activity_move', count(*) filter (where approved), count(*)
  from _activity_move_allowlist
union all
select 'thread_link_delete', count(*) filter (where approved), count(*)
  from _thread_link_delete_allowlist;

-- ---------------------------------------------------------------------------
-- EXPLICITLY GATED MUTATION
-- ---------------------------------------------------------------------------

\if :apply

\echo 'APPLY rehearsal enabled; exact snapshot/allowlist checks now run'

do $allowlist_assert$
declare
  v_approved bigint;
begin
  select
    (select count(*) from _project_repair_allowlist where approved)
    + (select count(*) from _direction_repair_allowlist where approved)
    + (select count(*) from _contact_repair_allowlist where approved)
    + (select count(*) from _activity_move_allowlist where approved)
    + (select count(*) from _thread_link_delete_allowlist where approved)
    into v_approved;

  if v_approved = 0 then
    raise exception 'apply=true but no exact allowlist row has approved=true';
  end if;
end
$allowlist_assert$;

-- Project link snapshot and conflict checks.
do $project_assert$
begin
  if exists (
    select 1
    from _project_repair_allowlist a
    join _repair_scope s on true
    left join public.projects p
      on p.id = a.project_id
     and p.company_id = s.company_id
     and p.deleted_at is null
    left join public.opportunities o
      on o.id = a.opportunity_id
     and o.company_id = s.company_id
     and o.deleted_at is null
    where a.approved
      and (
        p.id is null
        or o.id is null
        or p.status is distinct from a.expected_project_status
        or o.stage is distinct from a.expected_opportunity_stage
        or (
          a.set_won
          and replace(lower(p.status), ' ', '_') not in (
            'accepted', 'in_progress', 'completed', 'closed'
          )
        )
        or p.opportunity_ref is distinct from a.expected_project_opportunity_ref
        or p.opportunity_id is distinct from a.expected_project_opportunity_id
        or o.project_ref is distinct from a.expected_opportunity_project_ref
        or o.project_id is distinct from a.expected_opportunity_project_id
      )
  ) then
    raise exception 'project repair snapshot mismatch; re-run discovery and re-review';
  end if;

  -- A project may be unlinked or already linked to the reviewed opportunity.
  -- Reassigning it from any other opportunity would leave the old reverse
  -- mirror behind; that destructive unlink is deliberately outside this file.
  if exists (
    select 1
    from _project_repair_allowlist a
    join _repair_scope s on true
    join public.projects p
      on p.id = a.project_id
     and p.company_id = s.company_id
     and p.deleted_at is null
    where a.approved
      and (
        (p.opportunity_ref is not null and p.opportunity_ref <> a.opportunity_id)
        or (
          nullif(btrim(p.opportunity_id), '') is not null
          and (
            btrim(p.opportunity_id) !~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            or case
              when btrim(p.opportunity_id) ~*
                '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then p.opportunity_id::uuid <> a.opportunity_id
              else true
            end
          )
        )
      )
  ) then
    raise exception 'approved project already points to another opportunity; no implicit reassignment';
  end if;

  if exists (
    select 1
    from _project_repair_allowlist a
    join _repair_scope s on true
    join public.projects p
      on p.company_id = s.company_id
     and p.id <> a.project_id
     and p.deleted_at is null
     and coalesce(
       p.opportunity_ref,
       case
         when btrim(coalesce(p.opportunity_id, '')) ~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then p.opportunity_id::uuid
         else null
       end
     ) = a.opportunity_id
    where a.approved
  ) then
    raise exception 'an approved opportunity is already claimed by another project';
  end if;

  if exists (
    select 1
    from _project_repair_allowlist a
    join _repair_scope s on true
    join public.opportunities o
      on o.id = a.opportunity_id
     and o.company_id = s.company_id
    where a.approved
      and (
        (o.project_ref is not null and o.project_ref <> a.project_id)
        or (o.project_id is not null and o.project_id <> a.project_id)
      )
  ) then
    raise exception 'an approved opportunity points to a different project';
  end if;

  if exists (
    select 1
    from _project_repair_allowlist a
    join _repair_scope s on true
    join public.opportunities other_o
      on other_o.company_id = s.company_id
     and other_o.id <> a.opportunity_id
     and other_o.deleted_at is null
     and (
       other_o.project_ref = a.project_id
       or other_o.project_id = a.project_id
     )
    where a.approved
  ) then
    raise exception 'approved project is already claimed by another opportunity';
  end if;
end
$project_assert$;

create temp table _project_before on commit drop as
select
  a.project_id,
  a.opportunity_id,
  a.set_won,
  o.stage as from_stage,
  o.stage_entered_at
from _project_repair_allowlist a
join public.opportunities o on o.id = a.opportunity_id
where a.approved;

-- Suppress the new invariant trigger if it is installed; this script performs
-- and verifies the same mirror/won repair explicitly in one transaction.
select set_config('ops.skip_project_opportunity_invariant', 'on', true);

update public.projects p
set
  opportunity_ref = a.opportunity_id,
  opportunity_id = a.opportunity_id::text,
  updated_at = transaction_timestamp()
from _project_repair_allowlist a, _repair_scope s
where a.approved
  and p.id = a.project_id
  and p.company_id = s.company_id;

update public.opportunities o
set
  project_ref = a.project_id,
  project_id = a.project_id,
  stage = case when a.set_won then 'won' else o.stage end,
  stage_entered_at = case
    when a.set_won and o.stage is distinct from 'won'
      then transaction_timestamp()
    else o.stage_entered_at
  end,
  stage_manually_set = case when a.set_won then true else o.stage_manually_set end,
  actual_close_date = case
    when a.set_won then coalesce(o.actual_close_date, current_date)
    else o.actual_close_date
  end,
  updated_at = transaction_timestamp()
from _project_repair_allowlist a, _repair_scope s
where a.approved
  and o.id = a.opportunity_id
  and o.company_id = s.company_id;

insert into public.stage_transitions (
  company_id,
  opportunity_id,
  from_stage,
  to_stage,
  transitioned_at,
  transitioned_by,
  duration_in_stage
)
select
  s.company_id,
  b.opportunity_id,
  b.from_stage,
  'won',
  transaction_timestamp(),
  null,
  transaction_timestamp() - coalesce(b.stage_entered_at, transaction_timestamp())
from _project_before b
cross join _repair_scope s
where b.set_won
  and b.from_stage is distinct from 'won'
  and not exists (
    select 1
    from public.stage_transitions st
    where st.company_id = s.company_id
      and st.opportunity_id = b.opportunity_id
      and st.to_stage = 'won'
      and st.transitioned_at >= s.started_at
  );

select set_config('ops.skip_project_opportunity_invariant', 'off', true);

-- Direction snapshot checks and exact activity/event display repair. This does
-- not reconstruct party_role/is_meaningful/noise_reason or undo a historical
-- opportunity_lifecycle_state reset. Those semantics require a normal
-- classifier/lifecycle replay after a committed, reviewed repair.
do $direction_assert$
begin
  if exists (
    select 1
    from _direction_repair_allowlist r
    join _repair_scope s on true
    left join public.activities a
      on a.id = r.activity_id
     and a.company_id = s.company_id
    where r.approved
      and (
        a.id is null
        or a.opportunity_id is distinct from r.expected_opportunity_id
        or a.direction is distinct from r.expected_direction
        or lower(a.from_email) is distinct from lower(r.expected_from_email)
        or a.email_message_id is distinct from r.expected_provider_message_id
      )
  ) then
    raise exception 'direction repair snapshot mismatch; re-run discovery and re-review';
  end if;
end
$direction_assert$;

create temp table _impacted_opportunities (
  opportunity_id uuid primary key
) on commit drop;

insert into _impacted_opportunities
select expected_opportunity_id
from _direction_repair_allowlist
where approved and expected_opportunity_id is not null
on conflict do nothing;

update public.activities a
set direction = r.approved_direction
from _direction_repair_allowlist r, _repair_scope s
where r.approved
  and a.id = r.activity_id
  and a.company_id = s.company_id;

update public.opportunity_correspondence_events e
set direction = r.approved_direction
from _direction_repair_allowlist r, _repair_scope s
where r.approved
  and e.activity_id = r.activity_id
  and e.company_id = s.company_id;

-- Contact snapshot/provenance checks. Human/operator-confirmed provenance is a
-- hard stop even if a row was accidentally allowlisted.
do $contact_assert$
begin
  if exists (
    select 1
    from _contact_repair_allowlist r
    join _repair_scope s on true
    left join lateral (
      select
        true as entity_exists,
        case r.field_name
          when 'contact_name' then o.contact_name
          when 'contact_email' then o.contact_email
          when 'contact_phone' then o.contact_phone
          when 'contact_address' then o.address
        end as current_value
      from public.opportunities o
      where r.entity_type = 'opportunity'
        and o.id = r.entity_id
        and o.company_id = s.company_id
        and o.deleted_at is null
      union all
      select
        true,
        case r.field_name
          when 'contact_name' then c.name
          when 'contact_email' then c.email
          when 'contact_phone' then c.phone_number
          when 'contact_address' then c.address
        end
      from public.clients c
      where r.entity_type = 'client'
        and c.id = r.entity_id
        and c.company_id = s.company_id
        and c.deleted_at is null
    ) live on true
    where r.approved
      and (
        live.entity_exists is distinct from true
        or live.current_value is distinct from r.expected_value
      )
  ) then
    raise exception 'contact repair snapshot mismatch; re-run discovery and re-review';
  end if;

  if exists (
    select 1
    from _contact_repair_allowlist r
    join _repair_scope s on true
    join public.lead_field_provenance p
      on p.company_id = s.company_id
     and p.entity_type = r.entity_type
     and p.entity_id = r.entity_id
     and case p.field_name
       when 'name' then 'contact_name'
       when 'email' then 'contact_email'
       when 'phone' then 'contact_phone'
       when 'phone_number' then 'contact_phone'
       when 'address' then 'contact_address'
       else p.field_name
     end = r.field_name
    where r.approved
      and (
        p.source = 'operator'
        or p.actor_user_id is not null
        or p.confirmed_at is not null
        or p.confirmed_by is not null
      )
  ) then
    raise exception 'contact repair would overwrite operator/confirmed provenance';
  end if;
end
$contact_assert$;

with patch as (
  select
    entity_id,
    max(replacement_value) filter (where field_name = 'contact_name') as contact_name,
    max(replacement_value) filter (where field_name = 'contact_email') as contact_email,
    max(replacement_value) filter (where field_name = 'contact_phone') as contact_phone,
    max(replacement_value) filter (where field_name = 'contact_address') as contact_address
  from _contact_repair_allowlist
  where approved and entity_type = 'opportunity'
  group by entity_id
)
update public.opportunities o
set
  contact_name = coalesce(p.contact_name, o.contact_name),
  contact_email = coalesce(p.contact_email, o.contact_email),
  contact_phone = coalesce(p.contact_phone, o.contact_phone),
  address = coalesce(p.contact_address, o.address),
  updated_at = transaction_timestamp()
from patch p, _repair_scope s
where o.id = p.entity_id
  and o.company_id = s.company_id;

with patch as (
  select
    entity_id,
    max(replacement_value) filter (where field_name = 'contact_name') as contact_name,
    max(replacement_value) filter (where field_name = 'contact_email') as contact_email,
    max(replacement_value) filter (where field_name = 'contact_phone') as contact_phone,
    max(replacement_value) filter (where field_name = 'contact_address') as contact_address
  from _contact_repair_allowlist
  where approved and entity_type = 'client'
  group by entity_id
)
update public.clients c
set
  name = coalesce(p.contact_name, c.name),
  email = coalesce(p.contact_email, c.email),
  phone_number = coalesce(p.contact_phone, c.phone_number),
  address = coalesce(p.contact_address, c.address),
  updated_at = transaction_timestamp()
from patch p, _repair_scope s
where c.id = p.entity_id
  and c.company_id = s.company_id;

insert into public.lead_field_provenance (
  company_id,
  entity_type,
  entity_id,
  field_name,
  value_snapshot,
  source,
  confidence,
  provider_thread_id,
  provider_message_id,
  extracted_at,
  confirmed_at,
  updated_at
)
select
  s.company_id,
  r.entity_type,
  r.entity_id,
  r.field_name,
  r.replacement_value,
  'merge',
  1.0,
  r.provider_thread_id,
  r.provider_message_id,
  transaction_timestamp(),
  transaction_timestamp(),
  transaction_timestamp()
from _contact_repair_allowlist r
cross join _repair_scope s
where r.approved
on conflict (company_id, entity_type, entity_id, field_name)
do update set
  value_snapshot = excluded.value_snapshot,
  source = excluded.source,
  confidence = excluded.confidence,
  provider_thread_id = excluded.provider_thread_id,
  provider_message_id = excluded.provider_message_id,
  extracted_at = excluded.extracted_at,
  confirmed_at = excluded.confirmed_at,
  updated_at = excluded.updated_at;

-- Sandra-style activity movement requires an existing target with an exact
-- reviewed logical source key. No opportunity/client is created here.
do $move_assert$
begin
  if exists (
    select 1
    from _activity_move_allowlist r
    join _repair_scope s on true
    left join public.activities a
      on a.id = r.activity_id
     and a.company_id = s.company_id
    left join public.opportunities source_o
      on source_o.id = r.source_opportunity_id
     and source_o.company_id = s.company_id
     and source_o.deleted_at is null
    left join public.opportunities target_o
      on target_o.id = r.target_opportunity_id
     and target_o.company_id = s.company_id
     and target_o.deleted_at is null
    where r.approved
      and (
        a.id is null
        or source_o.id is null
        or target_o.id is null
        or source_o.client_id is distinct from r.expected_source_client_id
        or target_o.client_id is distinct from r.expected_target_client_id
        or a.opportunity_id is distinct from r.source_opportunity_id
        or a.client_id is distinct from r.expected_activity_client_id
        or a.suggested_client_id is distinct from r.expected_suggested_client_id
        or a.email_thread_id is distinct from r.expected_provider_thread_id
        or a.email_message_id is distinct from r.expected_provider_message_id
        or target_o.source_thread_key is distinct from r.expected_target_source_thread_key
      )
  ) then
    raise exception 'activity move snapshot/target mismatch; do not infer a split';
  end if;
end
$move_assert$;

insert into _impacted_opportunities
select source_opportunity_id from _activity_move_allowlist where approved
union
select target_opportunity_id from _activity_move_allowlist where approved
on conflict do nothing;

update public.activities a
set opportunity_id = r.target_opportunity_id,
    client_id = r.expected_target_client_id,
    suggested_client_id = r.replacement_suggested_client_id
from _activity_move_allowlist r, _repair_scope s
where r.approved
  and a.id = r.activity_id
  and a.company_id = s.company_id;

update public.opportunity_correspondence_events e
set opportunity_id = r.target_opportunity_id
from _activity_move_allowlist r, _repair_scope s
where r.approved
  and e.activity_id = r.activity_id
  and e.company_id = s.company_id;

do $thread_delete_assert$
begin
  if exists (
    select 1
    from _thread_link_delete_allowlist r
    join _repair_scope s on true
    left join public.opportunity_email_threads oet
      on oet.id = r.opportunity_email_thread_id
    left join public.opportunities o
      on o.id = oet.opportunity_id
     and o.company_id = s.company_id
    where r.approved
      and (
        oet.id is null
        or o.id is null
        or oet.opportunity_id is distinct from r.expected_opportunity_id
        or oet.thread_id is distinct from r.expected_thread_id
        or oet.connection_id is distinct from r.expected_connection_id
        or exists (
          select 1
          from public.activities a
          where a.company_id = s.company_id
            and a.opportunity_id = r.expected_opportunity_id
            and a.email_thread_id = r.expected_thread_id
            and not exists (
              select 1
              from _activity_move_allowlist move
              where move.approved
                and move.activity_id = a.id
                and move.source_opportunity_id = r.expected_opportunity_id
            )
        )
      )
  ) then
    raise exception 'thread-link delete snapshot mismatch; do not infer deletion';
  end if;
end
$thread_delete_assert$;

delete from public.opportunity_email_threads oet
using _thread_link_delete_allowlist r
where r.approved
  and oet.id = r.opportunity_email_thread_id;

-- Recompute denormalized correspondence counters only for opportunities whose
-- direction or activity ownership was explicitly changed. Email chronology is
-- event time, not import/repair time: an activity created during a historical
-- import may be months newer than the correspondence it represents.
with activity_facts as (
  select
    a.*,
    coalesce(
      (
        select max(e.occurred_at)
        from public.opportunity_correspondence_events e
        where e.company_id = a.company_id
          and e.activity_id = a.id
      ),
      a.created_at
    ) as effective_occurred_at
  from public.activities a
  join _repair_scope scope on scope.company_id = a.company_id
),
stats as (
  select
    i.opportunity_id,
    count(a.id) filter (where a.type = 'email')::int as correspondence_count,
    count(a.id) filter (
      where a.type = 'email' and a.direction = 'inbound'
    )::int as inbound_count,
    count(a.id) filter (
      where a.type = 'email' and a.direction = 'outbound'
    )::int as outbound_count,
    max(a.effective_occurred_at) as last_activity_at,
    max(a.effective_occurred_at) filter (
      where a.type = 'email' and a.direction = 'inbound'
    ) as last_inbound_at,
    max(a.effective_occurred_at) filter (
      where a.type = 'email' and a.direction = 'outbound'
    ) as last_outbound_at,
    (
      select case latest.direction
        when 'inbound' then 'in'
        when 'outbound' then 'out'
        else null
      end
      from activity_facts latest
      where latest.opportunity_id = i.opportunity_id
        and latest.type = 'email'
      order by latest.effective_occurred_at desc, latest.id desc
      limit 1
    ) as last_message_direction
  from _impacted_opportunities i
  left join activity_facts a on a.opportunity_id = i.opportunity_id
  group by i.opportunity_id
)
update public.opportunities o
set
  correspondence_count = s.correspondence_count,
  inbound_count = s.inbound_count,
  outbound_count = s.outbound_count,
  last_activity_at = s.last_activity_at,
  last_inbound_at = s.last_inbound_at,
  last_outbound_at = s.last_outbound_at,
  last_message_direction = s.last_message_direction,
  updated_at = transaction_timestamp()
from stats s, _repair_scope scope
where o.id = s.opportunity_id
  and o.company_id = scope.company_id;

-- ---------------------------------------------------------------------------
-- POST-MUTATION ASSERTIONS / READBACK
-- ---------------------------------------------------------------------------

do $project_post_assert$
begin
  if exists (
    select 1
    from _project_repair_allowlist a
    join public.projects p on p.id = a.project_id
    join public.opportunities o on o.id = a.opportunity_id
    where a.approved
      and (
        p.opportunity_ref is distinct from a.opportunity_id
        or p.opportunity_id is distinct from a.opportunity_id::text
        or o.project_ref is distinct from a.project_id
        or o.project_id is distinct from a.project_id
        or (a.set_won and o.stage is distinct from 'won')
      )
  ) then
    raise exception 'post-repair project/opportunity invariant failed';
  end if;
end
$project_post_assert$;

\echo 'Approved project repair readback'
select
  a.project_id,
  p.status,
  p.opportunity_ref,
  p.opportunity_id,
  a.opportunity_id,
  o.stage,
  o.project_ref,
  o.project_id
from _project_repair_allowlist a
join public.projects p on p.id = a.project_id
join public.opportunities o on o.id = a.opportunity_id
where a.approved;

\echo 'Approved direction repair readback'
select r.activity_id, a.opportunity_id, a.direction, a.from_email, a.email_message_id
from _direction_repair_allowlist r
join public.activities a on a.id = r.activity_id
where r.approved;

\echo 'Approved contact repair provenance readback'
select
  p.entity_type,
  p.entity_id,
  p.field_name,
  p.value_snapshot,
  p.source,
  p.provider_thread_id,
  p.provider_message_id,
  p.confirmed_at
from public.lead_field_provenance p
join _contact_repair_allowlist r
  on r.entity_type = p.entity_type
 and r.entity_id = p.entity_id
 and r.field_name = p.field_name
where r.approved;

\echo 'Approved activity move readback'
select
  r.activity_id,
  r.source_opportunity_id,
  a.opportunity_id as current_opportunity_id,
  r.target_opportunity_id,
  r.expected_target_client_id,
  a.client_id as current_client_id,
  a.suggested_client_id,
  a.email_thread_id,
  a.email_message_id
from _activity_move_allowlist r
join public.activities a on a.id = r.activity_id
where r.approved;

\echo 'NOTE: counts were recomputed, but event classifier fields and lifecycle state were not reconstructed.'
\echo 'Stage/summary/contact/client/title were not inferred. After commit, run and review the normal classifier/lifecycle evaluator.'

\else

\echo 'apply=false: mutation section skipped'

\endif

-- ---------------------------------------------------------------------------
-- FINAL GATE
-- ---------------------------------------------------------------------------

\if :apply
  \if :commit
    \echo 'COMMIT requested. Review all readback above before accepting this run.'
    commit;
  \else
    \echo 'apply rehearsal complete; commit=false so every change is ROLLED BACK.'
    rollback;
  \endif
\else
  \echo 'Discovery complete; apply=false so transaction is ROLLED BACK.'
  rollback;
\endif
