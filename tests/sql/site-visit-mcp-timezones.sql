-- Actual PostgreSQL civil-time output, consumed by the Node22 contract verifier.
create table private.workflow_timezone_outputs(payload jsonb not null);
do $$ declare sample record;proof jsonb;begin
 for sample in select * from (values
  ('America/Vancouver','2026-11-02T00:00:00',-420,'2026-11-02T07:00:00Z'),
  ('America/Edmonton','2024-11-03T01:30:00',-360,'2024-11-03T07:30:00Z'),
  ('America/Edmonton','2024-11-03T01:30:00',-420,'2024-11-03T08:30:00Z'),
  ('Asia/Kathmandu','2027-01-01T00:15:00',345,'2026-12-31T18:30:00Z'),
  ('Asia/Kolkata','2027-01-01T00:15:00',330,'2026-12-31T18:45:00Z'),
  ('America/St_Johns','2026-12-31T23:45:00',-210,'2027-01-01T03:15:00Z'),
  ('Pacific/Chatham','2027-01-01T00:15:00',825,'2026-12-31T10:30:00Z'),
  ('Pacific/Kiritimati','2027-01-01T00:15:00',840,'2026-12-31T10:15:00Z')
 ) cases(zone,civil,offset_minutes,utc_instant) loop
  proof:=private.agent_site_visit_workflow_time(sample.civil,sample.zone,sample.offset_minutes);
  if (proof->>'instant')::timestamptz<>sample.utc_instant::timestamptz or (proof->>'utc_offset_minutes')::int<>sample.offset_minutes then raise exception 'timezone conversion mismatch: %',proof;end if;
  insert into private.workflow_timezone_outputs values(jsonb_build_object('timezone',sample.zone,'probes',jsonb_build_array(proof)));
 end loop;
 begin perform private.agent_site_visit_workflow_time('2026-11-02T00:00:00','America/Vancouver',-480);raise exception 'outdated Vancouver offset accepted';exception when others then if sqlerrm<>'SITE_VISIT_LOCAL_TIME_OFFSET_INVALID' then raise;end if;end;
 raise notice 'PASS: PostgreSQL Vancouver, half/quarter-hour, negative offsets and cross-year UTC proof';
end $$;
-- Remove intentionally malformed synthetic availability records from prior cases.
delete from public.project_tasks;
delete from public.calendar_user_events;
do $$ declare ctx jsonb:=pg_temp.workflow_context();req jsonb;p jsonb;r jsonb;v public.site_visits%rowtype;old_zone text;begin
 select timezone into old_zone from public.companies where id=(ctx->>'company')::uuid;
 update public.companies set timezone='America/Vancouver' where id=(ctx->>'company')::uuid;
 req:=jsonb_build_object('operation','book','opportunity_id','30000000-0000-4000-8000-000000000001','idempotency_key','tz-vancouver-001','local_start','2028-11-02T10:00:00','duration_minutes',60,'assignee_ids',jsonb_build_array(ctx->>'actor'),'reminder_lead_minutes',null);
 p:=public.prepare_site_visit_workflow_as_system('tz-prepare',ctx,req);
 if p->>'status'<>'approval_required' or p#>>'{proposal,timezone_proof,probes,0,utc_offset_minutes}'<>'-420' then raise exception 'Vancouver approval unavailable: %',p;end if;
 update public.companies set timezone='America/Edmonton' where id=(ctx->>'company')::uuid;
 begin perform pg_temp.confirm_site_visit(p,'tz-changed-commit');raise exception 'company timezone edit accepted';exception when others then if sqlerrm<>'SITE_VISIT_SOURCE_STALE' then raise;end if;end;
 update public.companies set timezone='America/Vancouver' where id=(ctx->>'company')::uuid;
 begin perform pg_temp.confirm_site_visit(p,'tz-changed-commit');raise exception 'timezone ABA accepted';exception when others then if sqlerrm<>'SITE_VISIT_SOURCE_STALE' then raise;end if;end;
 req:=req||'{"idempotency_key":"tz-vancouver-002"}'::jsonb;
 p:=public.prepare_site_visit_workflow_as_system('tz-prepare-2',ctx,req);
 r:=pg_temp.confirm_site_visit(p,'tz-current-commit');
 if r->'appointment' is distinct from p#>'{proposal,appointment}' or r->'timezone_proof' is distinct from p#>'{proposal,timezone_proof}' or r->>'receipt_sha256' is distinct from private.agent_site_visit_workflow_hash(r-'receipt_sha256') then raise exception 'exact civil/timezone/UTC/offset receipt binding lost';end if;
 select * into v from public.site_visits where id=(r->>'site_visit_id')::uuid;
 req:=jsonb_build_object('operation','reschedule','site_visit_id',v.id,'expected_sha256',private.agent_site_visit_workflow_hash(to_jsonb(v)),'idempotency_key','tz-reschedule-001','local_start','2028-11-03T11:00:00');
 p:=public.prepare_site_visit_workflow_as_system('tz-reschedule',ctx,req);
 perform private.reschedule_site_visit_for_actor((ctx->>'actor')::uuid,v.id,'2028-11-02T19:00:00Z',null,null,null);
 begin perform pg_temp.confirm_site_visit(p,'tz-reschedule-commit');raise exception 'appointment edit accepted';exception when others then if sqlerrm not in('SITE_VISIT_SOURCE_STALE','SITE_VISIT_APPOINTMENT_STALE') then raise;end if;end;
 select * into v from public.site_visits where id=(r->>'site_visit_id')::uuid;
 req:=req||jsonb_build_object('expected_sha256',private.agent_site_visit_workflow_hash(to_jsonb(v)),'idempotency_key','tz-reschedule-002');
 p:=public.prepare_site_visit_workflow_as_system('tz-reschedule-2',ctx,req);
 r:=pg_temp.confirm_site_visit(p,'tz-reschedule-commit-2');
 if r->'timezone_proof' is distinct from p#>'{proposal,timezone_proof}' then raise exception 'reschedule proof lost';end if;
 begin perform public.inspect_site_visit_workflow_as_system('tz-caller-proof',ctx,req||jsonb_build_object('timezone_proof',r->'timezone_proof'));raise exception 'caller proof accepted';exception when others then if sqlerrm<>'SITE_VISIT_INPUT_INVALID' then raise;end if;end;
 update public.companies set timezone=old_zone where id=(ctx->>'company')::uuid;
 raise notice 'PASS: changed company timezone, ABA and appointment edits invalidate approval; exact booking/reschedule proof is sealed in receipts';
end $$;
