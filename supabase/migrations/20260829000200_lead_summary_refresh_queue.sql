-- Durable, actor-agnostic queue for debounced Phase C lead-summary refreshes.
--
-- Bug a2042514. Logging an activity changed what is true about a lead, but the
-- summary only caught up on the next recurring sweep — up to an hour later, and
-- only if that lead came up in the rotation.
--
-- The web app now calls the eager endpoint directly, but the web app is not the
-- only writer: iOS writes activities and project_notes straight through
-- PostgREST, where no web code runs at all. These triggers make the enqueue a
-- property of the WRITE, not of the client that made it.
--
-- `on conflict do update` is the debounce: a burst of writes against one lead
-- collapses to a single queue row, and the cron drains it once the lead has
-- been quiet for a couple of minutes.

create table public.lead_summary_refresh_requests (
  opportunity_id uuid primary key
    references public.opportunities(id) on delete cascade,
  company_id uuid not null,
  requested_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Service-role only. RLS on with no policies denies every anon/authenticated
-- read and write; the revoke is belt-and-braces against a future default grant.
alter table public.lead_summary_refresh_requests enable row level security;
revoke all on public.lead_summary_refresh_requests from public, anon, authenticated;

-- Drained oldest-first, so the queue read is an index scan, not a sort.
create index lead_summary_refresh_requests_requested_at_idx
  on public.lead_summary_refresh_requests (requested_at);

create or replace function public.tg_enqueue_lead_summary_refresh_from_activity()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
begin
  if new.opportunity_id is null or new.type = 'email' then
    return new;  -- email activity refreshes ride the durable email cycle already
  end if;
  insert into public.lead_summary_refresh_requests (opportunity_id, company_id, requested_at)
  values (new.opportunity_id, new.company_id, now())
  on conflict (opportunity_id) do update set requested_at = excluded.requested_at;
  return new;
end $$;

create trigger trg_activities_lead_summary_refresh
after insert on public.activities
for each row execute function public.tg_enqueue_lead_summary_refresh_from_activity();

create or replace function public.tg_enqueue_lead_summary_refresh_from_project_note()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public','pg_temp'
as $$
declare v_opportunity uuid; v_company uuid;
begin
  if new.deleted_at is not null then return new; end if;
  -- projects.id is uuid; project_notes.project_id is text (legacy). Resolve the linked lead.
  select o.id, o.company_id into v_opportunity, v_company
    from public.projects p
    join public.opportunities o
      on (o.project_id = p.id or o.project_ref = p.id
          or p.opportunity_ref = o.id or p.opportunity_id = o.id::text)
   where p.id::text = new.project_id
     and o.deleted_at is null
   order by o.created_at desc
   limit 1;
  if v_opportunity is null then return new; end if;
  insert into public.lead_summary_refresh_requests (opportunity_id, company_id, requested_at)
  values (v_opportunity, v_company, now())
  on conflict (opportunity_id) do update set requested_at = excluded.requested_at;
  return new;
end $$;

create trigger trg_project_notes_lead_summary_refresh
after insert on public.project_notes
for each row execute function public.tg_enqueue_lead_summary_refresh_from_project_note();
