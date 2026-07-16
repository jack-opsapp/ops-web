begin;

-- Browser clients use authenticated server routes that return explicit public
-- projections. These tables contain provider credentials, generated bodies,
-- queued outbound content, or private attachment metadata and must never be a
-- direct PostgREST surface. RLS remains enabled as defense in depth, but table
-- privileges close the permissive legacy-policy gap before policy evaluation.
revoke all on table public.email_connections from public;
revoke all on table public.email_connections from anon, authenticated;
grant select, insert, update, delete
  on table public.email_connections to service_role;

revoke all on table public.ai_draft_history from public;
revoke all on table public.ai_draft_history from anon, authenticated;
grant select, insert, update, delete
  on table public.ai_draft_history to service_role;

revoke all on table public.pending_auto_sends from public;
revoke all on table public.pending_auto_sends from anon, authenticated;
grant select, insert, update, delete
  on table public.pending_auto_sends to service_role;

revoke all on table public.email_attachments from public;
revoke all on table public.email_attachments from anon, authenticated;
grant select, insert, update, delete
  on table public.email_attachments to service_role;

comment on table public.email_connections is
  'Server-only mailbox connection store. Browser consumers use credential-free authenticated route projections.';
comment on table public.ai_draft_history is
  'Server-only draft provenance and operator-outcome history.';
comment on table public.pending_auto_sends is
  'Server-only durable Phase C outbound source queue.';
comment on table public.email_attachments is
  'Server-only email attachment metadata; authorized bytes and descriptors are served through scoped routes.';

commit;
