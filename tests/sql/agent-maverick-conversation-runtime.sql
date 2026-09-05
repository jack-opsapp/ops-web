\set ON_ERROR_STOP on
begin;
set local request.jwt.claim.role='service_role';
select maverick_test.check(maverick_test.conversation()->'recent_turns'='[]'::jsonb,'empty conversation full public chain');
insert into private.agent_provider_delivery_sources(id,company_id,connection_id,provider,provider_message_id,provider_thread_id,direction,delivered_at,subject,normalized_subject,normalized_plain_text,normalization_revision,normalization_status,sender_identity,recipient_identities,cc_recipient_identities,content_media_type,content_value,content_source_kind,content_selection_revision,attachment_enumeration_complete,attachment_descriptors,attachment_evidence_ids,source_sha256) values (
'91000000-0000-4000-8000-000000000007','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000005','gmail','message-1','thread-1','inbound','2026-09-01T12:00:00Z','Raw subject','Provider subject','Provider authoritative body','delivery-source-normalization:v2','normalized','customer@example.com',array['fixture@example.com'],array['cc@example.com'],'text/plain','Provider authoritative body','provider_body','provider-body-selection:v1',true,'[]',array['attachment:1'],'sha256:'||repeat('a',64));
insert into public.job_conversation_turns(id,company_id,conversation_id,turn_sequence,source_state_revision,side,participant_id,participant_resolution_status,participant_resolution_revision,direction,channel,delivered_at,source_connection_id,provider_message_id,provider_delivery_source_id,provider_delivery_source_sha256,subject,normalized_plain_text,original_content_hash) values (
'91000000-0000-4000-8000-000000000008','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000006',1,1,'customer','customer@example.com','resolved','resolution:1','inbound','email','2026-09-01T12:00:00Z','91000000-0000-4000-8000-000000000005','message-1','91000000-0000-4000-8000-000000000007','sha256:'||repeat('a',64),'Stale turn subject','Stale turn body','sha256:'||repeat('b',64));
update public.job_conversations set last_turn_sequence=1,source_state_revision=1 where id='91000000-0000-4000-8000-000000000006';
insert into public.job_memory_versions(id,company_id,conversation_id,version_number,turn_high_watermark_id,turn_high_watermark_sequence,source_state_revision,generation_input_hash,memory_document,memory_document_hash,generator_revision) values (
'91000000-0000-4000-8000-000000000009','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000006',1,'91000000-0000-4000-8000-000000000008',1,1,'sha256:'||repeat('c',64),'{}','sha256:'||repeat('d',64),'fixture:1');
update public.job_conversations set current_memory_version_id='91000000-0000-4000-8000-000000000009' where id='91000000-0000-4000-8000-000000000006';
insert into public.job_memory_version_evidence(company_id,conversation_id,memory_version_id,evidence_id,relationship,source_domain,source_type,source_entity_id,source_revision) values (
'91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000006','91000000-0000-4000-8000-000000000009','job_conversation_turn:91000000-0000-4000-8000-000000000008','supports','job_conversation','delivered_email_turn','91000000-0000-4000-8000-000000000008','revision:1');
do $populated$
declare r jsonb := maverick_test.conversation('91000000-0000-4000-8000-000000000008');begin
 perform maverick_test.check(r#>>'{recent_turns,0,source_connection_id}'='91000000-0000-4000-8000-000000000005','provider connection alias');
 perform maverick_test.check(r#>>'{recent_turns,0,subject}'='Provider subject' and r#>>'{recent_turns,0,normalized_plain_text}'='Provider authoritative body','provider content overrides stale turn projection');
 perform maverick_test.check(r#>>'{recent_turns,0,provider_delivery_source_sha256}'='sha256:'||repeat('a',64) and r#>>'{recent_turns,0,original_content_hash}'='sha256:'||repeat('a',64),'distinct provider and original hash aliases');
 perform maverick_test.check(r#>>'{active_evidence,0,excerpt}'='Provider authoritative body','populated evidence alias path');
 perform maverick_test.check(r#>>'{required_through,state}'='summarized','required-through and memory path');
 perform maverick_test.check(jsonb_array_length(r->'participants')=1,'participant path');
end;$populated$;
-- Exact provider tuple is mandatory; do not fall back to the stale turn text.
update private.agent_provider_delivery_sources set connection_id='91000000-0000-4000-8000-000000000099' where id='91000000-0000-4000-8000-000000000007';
select maverick_test.check(maverick_test.conversation()->'recent_turns'='[]'::jsonb,'provider connection mismatch hides turn');
update private.agent_provider_delivery_sources set connection_id='91000000-0000-4000-8000-000000000005' where id='91000000-0000-4000-8000-000000000007';
update private.agent_provider_delivery_sources set source_sha256='sha256:'||repeat('f',64) where id='91000000-0000-4000-8000-000000000007';
select maverick_test.check(maverick_test.conversation()->'recent_turns'='[]'::jsonb,'provider hash mismatch hides turn');
update private.agent_provider_delivery_sources set source_sha256='sha256:'||repeat('a',64), normalization_status='failed' where id='91000000-0000-4000-8000-000000000007';
do $normalization$begin
 begin perform maverick_test.conversation();raise exception 'invalid provider normalization accepted';exception when sqlstate '22000' then
   if sqlerrm <> 'agent_job_context_provider_source_data_invalid' then raise;end if;
 end;
 perform maverick_test.check(true,'failed provider normalization rejects context');
end;$normalization$;
update private.agent_provider_delivery_sources set normalization_status='normalized' where id='91000000-0000-4000-8000-000000000007';
insert into public.job_conversation_redaction_events(company_id,conversation_id,target_turn_id,redaction_kind,reason,authority_revision,source_state_revision)
select '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000006','91000000-0000-4000-8000-000000000008',kind,'fixture','fixture:1',4 from unnest(array['content_redacted','attachment_redacted','participant_pseudonymized']) kind;
update public.job_conversations set source_state_revision=4 where id='91000000-0000-4000-8000-000000000006';
do $redacted$
declare r jsonb := maverick_test.conversation('91000000-0000-4000-8000-000000000008');begin
 perform maverick_test.check(r#>>'{recent_turns,0,subject}'='[SUBJECT REDACTED]' and r#>>'{recent_turns,0,normalized_plain_text}'='[CONTENT REDACTED]','content redaction');
 perform maverick_test.check(r#>'{recent_turns,0,attachment_evidence_ids}'='[]' and r#>'{recent_turns,0,recipient_identities}'='[]','attachment and recipient redaction');
 perform maverick_test.check(r#>>'{recent_turns,0,provider_delivery_source_sha256}' is null and r#>>'{recent_turns,0,participant_id}'='[PARTICIPANT REDACTED]','hash and participant redaction');
 perform maverick_test.check(r#>>'{active_evidence,0,excerpt}'='[CONTENT REDACTED]' and jsonb_array_length(r->'invalidated_evidence_ids')=1,'redacted evidence and memory invalidation');
end;$redacted$;
do $tenant$begin
 begin perform maverick_test.conversation(null,'91000000-0000-4000-8000-000000000099');raise exception 'foreign tenant accepted';exception when no_data_found or insufficient_privilege then null;end;
 perform maverick_test.check(true,'cross-tenant context denied');
end;$tenant$;
update public.users set is_active=false where id='91000000-0000-4000-8000-000000000002';
do $inactive$begin
 begin perform maverick_test.conversation();raise exception 'inactive actor accepted';exception when no_data_found or insufficient_privilege or invalid_parameter_value then null;end;
 perform maverick_test.check(true,'inactive actor denied');
end;$inactive$;
rollback;
