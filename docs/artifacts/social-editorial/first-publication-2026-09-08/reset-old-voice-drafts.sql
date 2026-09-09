-- Operator action approved by Jackson on 2026-09-08: rewrite the two drafts
-- authored under the pre-copywriter voice. Touches only the two named rows,
-- only while they are still held (prepared) with no post, and prints them back.
begin;
update public.social_editorial_assignments set
  state='queued', mode=null, attempts=0, submissions=0,
  claim_token=null, lease_until=null, claimed_by=null,
  next_attempt_at=now(), last_code=null, package=null, preview=null,
  drafted_at=null, prepared_at=null, notified_at=null, guide_sha256=null,
  attempt_log=coalesce(attempt_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'at',now(),'code','OPERATOR_RESET',
    'detail','Rewrite in the OPS copywriter voice (approved by Jackson 2026-09-08)')),
  updated_at=now()
where identity in ('blog:e0d5ff01-97cd-4168-bcc3-70b2cd094d2b','blog:85c62b33-8349-473b-bf9b-e6f75fd46c50')
  and state='prepared' and post_id is null
returning identity, state, attempts, mode, jsonb_array_length(attempt_log) as log_entries;
commit;
select identity, state, attempts, mode, to_char(created_at,'MM-DD HH24:MI') as created
from public.social_editorial_assignments order by created_at;
