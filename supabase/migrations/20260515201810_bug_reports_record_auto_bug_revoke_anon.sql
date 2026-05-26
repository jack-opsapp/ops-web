begin;

-- The record_auto_bug RPC already rejects null-JWT callers via
-- private.get_current_user_id(), but the SECURITY DEFINER linter flags any
-- anon-callable definer function as a risk surface. Explicitly revoke from
-- public + anon so only authenticated JWTs reach the function body.
revoke execute on function public.record_auto_bug(
  text, text, text, text, text, text, jsonb, text, text, text, text, text
) from public;

revoke execute on function public.record_auto_bug(
  text, text, text, text, text, text, jsonb, text, text, text, text, text
) from anon;

grant execute on function public.record_auto_bug(
  text, text, text, text, text, text, jsonb, text, text, text, text, text
) to authenticated;

commit;
