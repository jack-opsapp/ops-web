-- Phone-owned intentional packet discard. No activation or booking cancellation bypass.
begin;
create table private.site_visit_discard_receipts (
 command_id uuid primary key,actor_id uuid not null,company_id text not null,site_visit_id uuid not null,
 request jsonb not null,receipt jsonb not null
);
alter table private.site_visit_discard_receipts enable row level security;
revoke all on private.site_visit_discard_receipts from public,anon,authenticated,service_role;
create function public.discard_site_visit_capture(p_command_id uuid,p_capture jsonb,p_discarded_at timestamptz,p_expected_actor uuid) returns jsonb
language plpgsql volatile security definer set search_path='' set lock_timeout='2s' as $$
declare actor uuid:=private.get_current_user_id();company text:=private.get_user_company_id()::text;
 visit public.site_visits%rowtype;prior private.site_visit_discard_receipts%rowtype;request jsonb;receipt jsonb;visit_id uuid;
begin
 if actor is null or actor is distinct from p_expected_actor or company is null or p_command_id is null or p_discarded_at is null
  or jsonb_typeof(p_capture) is distinct from 'object' or octet_length(p_capture::text)>1048576
  or p_capture->>'company_id' is distinct from company then raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
 visit_id:=(p_capture->>'id')::uuid;
 if visit_id is null then raise exception 'SITE_VISIT_DISCARD_INVALID' using errcode='22023';end if;
 request:=jsonb_build_object('capture',p_capture,'discarded_at',p_discarded_at);
 perform pg_advisory_xact_lock(hashtextextended('site-visit-discard-command:'||p_command_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('site-visit-capture:'||visit_id::text,0));
 select * into visit from public.site_visits where id=visit_id for update;
 if found then
  if visit.company_id<>company or not private.actor_can_edit_site_visit(actor,company,visit.opportunity_id,visit.project_id,visit.project_ref) then
   raise exception 'SITE_VISIT_AUTHORITY_DENIED' using errcode='42501';end if;
 else
  -- A never-uploaded packet still gets a tombstoned identity so a delayed
  -- parent create cannot reopen it. Its captured relationships are authorized
  -- by the existing capture wrapper; no children need uploading to discard.
  select * into visit from public.save_site_visit_capture(p_capture,p_expected_actor);
 end if;
 select * into prior from private.site_visit_discard_receipts where command_id=p_command_id;
 if found then
  if prior.actor_id<>actor or prior.company_id<>company or prior.site_visit_id<>visit_id or prior.request<>request then
   raise exception 'SITE_VISIT_DISCARD_REPLAY_MISMATCH' using errcode='22023';end if;
  return prior.receipt;
 end if;
 if visit.booked_at is not null or visit.status in ('completed','cancelled') or visit.deleted_at is not null then
  raise exception 'SITE_VISIT_DISCARD_CLOSED' using errcode='55000';end if;
 -- Intentional removal preserves historical values/evidence verbatim; it does
 -- not add references or reinterpret absent/removed media as usable evidence.
 -- Tombstone answers while the locked parent is still open, then its media.
 update public.site_visit_checklist_answers set deleted_at=p_discarded_at,write_base_revision=coalesce(write_revision,0)
  where site_visit_id=visit_id and company_id=company and deleted_at is null;
 update public.site_visit_artifacts set deleted_at=p_discarded_at,updated_at=clock_timestamp()
  where site_visit_id=visit_id and company_id=company and deleted_at is null;
 update public.site_visit_identity_drafts set deleted_at=p_discarded_at,updated_at=clock_timestamp()
  where site_visit_id=visit_id and company_id=company and deleted_at is null;
 update public.site_visits set deleted_at=p_discarded_at,updated_at=clock_timestamp() where id=visit_id;
 receipt:=jsonb_build_object('command_id',p_command_id,'company_id',company,'site_visit_id',visit_id,'discarded_at',p_discarded_at,'outcome','discarded');
 insert into private.site_visit_discard_receipts values(p_command_id,actor,company,visit_id,request,receipt);
 return receipt;
end$$;
revoke all on function public.discard_site_visit_capture(uuid,jsonb,timestamptz,uuid) from public,anon,service_role;
grant execute on function public.discard_site_visit_capture(uuid,jsonb,timestamptz,uuid) to anon,authenticated;
commit;
