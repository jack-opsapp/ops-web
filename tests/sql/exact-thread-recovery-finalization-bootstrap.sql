-- Synthetic contract fixture for an isolated PostgreSQL database only.
create schema private;
create schema auth;
create schema test;
create role anon;
create role authenticated;
create role service_role;
create function auth.role() returns text language sql as $$ select current_setting('test.role',true) $$;
create function auth.jwt() returns jsonb language sql as $$ select jsonb_build_object('role',auth.role()) $$;
create table public.companies(id uuid primary key);
create table public.users(id uuid primary key, company_id uuid, deleted_at timestamptz, is_active boolean);
create table public.email_connections(id uuid primary key, company_id text, status text, provider text, email text, sync_enabled boolean, sync_lock_owner uuid, sync_in_progress_at timestamptz);
create table private.email_provider_mailbox_sync_leases(connection_id uuid primary key,owner_id uuid,expires_at timestamptz);
create table public.opportunities(id uuid primary key,company_id uuid,client_id uuid,client_ref uuid,contact_email text,contact_name text,title text,stage text,stage_manually_set boolean,assigned_to uuid,assignment_version bigint,project_id uuid,project_ref uuid,archived_at timestamptz,deleted_at timestamptz,merged_into_opportunity_id uuid,source_thread_key text,updated_at timestamptz);
create table public.email_threads(id uuid primary key,company_id uuid,connection_id uuid,provider_thread_id text,opportunity_id uuid,client_id uuid,archived_at timestamptz,updated_at timestamptz,subject text,message_count integer,latest_snippet text,unique(connection_id,provider_thread_id));
create table public.opportunity_email_threads(id uuid primary key,connection_id uuid,thread_id text,opportunity_id uuid,created_at timestamptz,unique(connection_id,thread_id));
create table public.activities(id uuid primary key,company_id uuid,email_connection_id uuid,email_thread_id text,email_message_id text,opportunity_id uuid,type text,direction text,email_from text,email_to text[],email_cc text[],body_text text,created_at timestamptz);
create table public.opportunity_correspondence_events(id uuid primary key,company_id uuid,connection_id uuid,provider_thread_id text,provider_message_id text,opportunity_id uuid,activity_id uuid,direction text,party_role text,is_meaningful boolean,opportunity_projection_applied boolean,from_email text,to_emails text[],cc_emails text[],occurred_at timestamptz);
create table private.email_exact_message_recovery_applications(company_id uuid,connection_id uuid,provider_message_id text,provider_thread_id text,source_opportunity_id uuid,target_opportunity_id uuid,activity_id uuid,correspondence_event_id uuid,target_email text,actor_user_id uuid,manifest_sha256 text,entry_sha256 text,target_resolution text,target_source_thread_key text,target_initial_title text,target_initial_contact_name text,status text,attachment_count integer,attachment_scan_generation bigint,attachment_ids uuid[],applied_at timestamptz,finalized_at timestamptz,primary key(company_id,connection_id,provider_message_id));
create table public.email_attachments(id uuid primary key,company_id uuid,connection_id uuid,provider_thread_id text,message_id text,activity_id uuid,attribution_status text,opportunity_id uuid,ingest_status text);
create table public.email_attachment_scans(id uuid primary key,company_id uuid,connection_id uuid,provider_thread_id text,message_id text,activity_id uuid,status text,generation bigint);
create table public.email_attachment_inspection_jobs(id uuid primary key,email_attachment_id uuid,status text);
create table public.email_conversion_photo_jobs(id uuid primary key,email_attachment_id uuid,status text,operation text);
create table public.email_conversion_photo_objects(id uuid primary key,job_id uuid,state text);
create table private.opportunity_child_reparent_tokens(transaction_id bigint,backend_pid integer,table_name text,row_id uuid,old_opportunity_id uuid,new_opportunity_id uuid,primary key(transaction_id,backend_pid,table_name,row_id));
create table public.duplicate_reviews(id uuid,company_id uuid,entity_type text,status text,entity_a_id uuid,entity_b_id uuid);
create function private.try_parse_uuid(value text) returns uuid language sql immutable as $$ select value::uuid $$;
create function private.lock_lead_assignment_company(value uuid) returns void language sql as $$ select pg_advisory_xact_lock(hashtextextended(value::text,1)) $$;
create function private.lock_email_thread_data_review(company uuid,connection uuid,thread text) returns void language sql as $$ select pg_advisory_xact_lock(hashtextextended(company::text||connection::text||thread,2)) $$;
create function public.authorize_email_inbox_action_as_system(actor uuid,connection uuid,thread text,action text) returns boolean language sql as $$ select coalesce(current_setting('test.mailbox_allowed',true),'true')='true' $$;
create function private.user_can_edit_opportunity(actor uuid,opportunity uuid) returns boolean language sql as $$ select coalesce(current_setting('test.edit_allowed',true),'true')='true' $$;
create function private.effective_pipeline_scope_for_user(actor uuid,company uuid,permission text) returns text language sql as $$ select coalesce(current_setting('test.pipeline_scope',true),'all') $$;
create function private.opportunity_sender_is_persisted_customer(company uuid,opportunity uuid,email text) returns boolean language sql as $$ select exists(select 1 from public.opportunities o where o.id=opportunity and o.company_id=company and o.contact_email=email) $$;
-- The actual attachment-state function is installed by the runner.
create function public.set_email_threads_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end $$;
create trigger email_threads_updated_at before update on public.email_threads for each row execute function public.set_email_threads_updated_at();
-- Actual deployed ownership trigger definitions are appended by the runner.

create table test.config(value jsonb);
create function test.assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'assertion failed: %',label; end if; end $$;
create function test.expect_error(command text,fragment text) returns void language plpgsql as $$ begin
  begin execute command; exception when others then
    if position(fragment in sqlerrm)=0 then raise exception 'wanted %, got %',fragment,sqlerrm; end if;
    return;
  end;
  raise exception 'expected error: %',fragment;
end $$;
