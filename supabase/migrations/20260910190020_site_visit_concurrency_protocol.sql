-- Phase19 compatibility contract. No company is enabled by this migration.
-- Activation requires a compatible signed phone release and separate approval.
create table private.site_visit_concurrency_companies (
  company_id text primary key,
  enabled_at timestamptz not null default clock_timestamp(),
  protocol_revision text not null default 'site-visit-writes:2026-09-10.v1'
    check (protocol_revision='site-visit-writes:2026-09-10.v1')
);
alter table private.site_visit_concurrency_companies enable row level security;
revoke all on private.site_visit_concurrency_companies from public,anon,authenticated,service_role;

-- Nullable additions preserve the wire shape for installed clients. NULL means
-- pre-protocol revision zero. The base is a request-only value, never persisted.
alter table public.site_visit_types add column write_revision bigint;
alter table public.site_visit_types add column write_base_revision bigint;
alter table public.site_visit_checklist_answers add column write_revision bigint;
alter table public.site_visit_checklist_answers add column write_base_revision bigint;
alter table public.site_visit_checklist_answers add column answer_state text;
alter table public.site_visit_checklist_answers add column answer_evidence jsonb;
alter table public.site_visit_checklist_answers add constraint site_visit_answer_state_valid
  check(answer_state is null or answer_state in ('answered','unknown','cleared'));
alter table public.site_visit_checklist_answers add constraint site_visit_answer_evidence_bound
  check(answer_evidence is null or (jsonb_typeof(answer_evidence)='object' and octet_length(answer_evidence::text)<=131072));

create function private.site_visit_concurrency_enabled(p_company text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.site_visit_concurrency_companies where company_id=p_company)
$$;

-- One-use transaction tokens protect internal evidence fields from direct REST
-- callers. A forged base revision is never a provenance authorization.
create table private.site_visit_write_tokens(transaction_id bigint,backend_pid integer,entity text,row_id text,
  primary key(transaction_id,backend_pid,entity,row_id));
alter table private.site_visit_write_tokens enable row level security;
revoke all on private.site_visit_write_tokens from public,anon,authenticated,service_role;

create function private.site_visit_guard_versioned_write() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare
  authorized boolean:=false;
  before_value jsonb; after_value jsonb; visit public.site_visits%rowtype;
  enforced boolean:=private.site_visit_concurrency_enabled(new.company_id);
begin
  delete from private.site_visit_write_tokens where transaction_id=txid_current() and backend_pid=pg_backend_pid()
    and entity=tg_table_name and row_id=new.id::text returning true into authorized;
  if tg_table_name='site_visit_checklist_answers' and not coalesce(authorized,false) and
    ((tg_op='INSERT' and (nullif(to_jsonb(new)->'answer_state','null') is not null or nullif(to_jsonb(new)->'answer_evidence','null') is not null)) or
     (tg_op='UPDATE' and (to_jsonb(new)->'answer_state' is distinct from to_jsonb(old)->'answer_state' or to_jsonb(new)->'answer_evidence' is distinct from to_jsonb(old)->'answer_evidence'))) then
    raise exception 'SITE_VISIT_PROVENANCE_FORBIDDEN' using errcode='42501';end if;
  if enforced and tg_table_name='site_visit_types' then
    perform pg_advisory_xact_lock(hashtextextended('site-visit-writes:'||new.company_id,0));
  end if;
  -- Ignore timestamp-only retries, but never hide a metadata or tombstone edit.
  after_value:=to_jsonb(new)-array['write_revision','write_base_revision','updated_at'];
  if tg_op='UPDATE' then
    before_value:=to_jsonb(old)-array['write_revision','write_base_revision','updated_at'];
    if after_value=before_value then old.write_revision:=coalesce(old.write_revision,0);return old;end if;
    -- The existing parent propagation trigger owns this one derived link.
    -- It may run after completion. It cannot authorize any answer/metadata edit.
    if tg_table_name='site_visit_checklist_answers' and
       after_value-'opportunity_id'=before_value-'opportunity_id' then
      select * into visit from public.site_visits where id=new.site_visit_id for update;
      if found and visit.company_id=new.company_id and
         visit.opportunity_id is not distinct from new.opportunity_id then
        new.write_revision:=coalesce(old.write_revision,0)+1;
        new.write_base_revision:=null;new.updated_at:=clock_timestamp();return new;
      end if;
      raise exception 'SITE_VISIT_PARENT_INVALID' using errcode='42501';
    end if;
  end if;
  if enforced and tg_table_name='site_visit_checklist_answers' then
    -- FOR UPDATE serializes completion, selection and edits on this parent.
    select * into visit from public.site_visits where id=new.site_visit_id for update;
    if not found or visit.company_id is distinct from new.company_id then
      raise exception 'SITE_VISIT_PARENT_INVALID' using errcode='42501';
    end if;
    if visit.deleted_at is not null or visit.status in ('completed','cancelled') then
      raise exception 'SITE_VISIT_CAPTURE_CLOSED' using errcode='55000';
    end if;
  end if;
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.company_id is distinct from old.company_id then
      raise exception 'SITE_VISIT_IDENTITY_IMMUTABLE' using errcode='42501';
    end if;
    if enforced and new.write_base_revision is distinct from coalesce(old.write_revision,0) then
      raise exception 'SITE_VISIT_WRITE_CONFLICT' using errcode='40001',
        detail=jsonb_build_object('entity',tg_table_name,'id',old.id,'current_revision',coalesce(old.write_revision,0),
          'reason',case when new.write_base_revision is null then 'client_update_required' else 'stale_edit' end)::text;
    end if;
    if enforced and tg_table_name='site_visit_checklist_answers' and
      (to_jsonb(new)-array['answer_value','answer_state','answer_evidence','deleted_at','updated_at','write_revision','write_base_revision','opportunity_id'])
      is distinct from (to_jsonb(old)-array['answer_value','answer_state','answer_evidence','deleted_at','updated_at','write_revision','write_base_revision','opportunity_id']) then
      raise exception 'SITE_VISIT_SNAPSHOT_IMMUTABLE' using errcode='55000';
    end if;
    new.write_revision:=coalesce(old.write_revision,0)+1;
  else
    if enforced and new.write_base_revision is distinct from 0::bigint then
      raise exception 'SITE_VISIT_INSERT_BASE_INVALID' using errcode='40001';
    end if;
    new.write_revision:=1;
  end if;
  new.write_base_revision:=null;
  new.updated_at:=clock_timestamp();
  return new;
end $$;
-- Run after existing timestamp triggers so an exact replay preserves its version.
create trigger zz_site_visit_types_version before insert or update on public.site_visit_types
for each row execute function private.site_visit_guard_versioned_write();
create trigger zz_site_visit_checklist_version before insert or update on public.site_visit_checklist_answers
for each row execute function private.site_visit_guard_versioned_write();

revoke all on function private.site_visit_concurrency_enabled(text) from public,anon,authenticated,service_role;
revoke all on function private.site_visit_guard_versioned_write() from public,anon,authenticated,service_role;
comment on column public.site_visit_checklist_answers.write_base_revision is
  'Request-only original revision. Always reset to NULL. Missing/stale bases cannot change protected rows.';
comment on table private.site_visit_concurrency_companies is
  'Explicit compatibility gate. Empty on installation. Never disable after MCP writes without draining conflicts and all device queues.';
