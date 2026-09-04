-- Rollback for 20260903200000_users_team_directory_index_execute_contract.sql.
--
-- WARNING: applying this rollback RESTORES A TOTAL USER-CREATION OUTAGE. Every non-postgres
-- INSERT into public.users, and every UPDATE that cannot be applied HOT (which includes every
-- identity repair, because auth_id and firebase_uid are both indexed), will fail with
-- 42501 permission denied for function agent_p2_optional_canonical_text.
--
-- Only apply if the grant is proven to cause a worse problem than that outage.
begin;

revoke execute on function
  private.agent_p2_optional_canonical_text(text, integer, integer, boolean)
  from anon, authenticated, service_role;

revoke execute on function
  private.agent_prompt_text_is_safe(text, boolean)
  from anon, authenticated, service_role;

commit;
