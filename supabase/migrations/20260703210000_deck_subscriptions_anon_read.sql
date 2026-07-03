begin;

-- Deckset iOS reads PostgREST with a Firebase ID token that carries no `role`
-- claim, so its requests execute as `anon` — the execution context
-- deck_designs already serves through its `TO public` company_isolation
-- policy backed by private.get_user_company_id() (matches users.auth_id OR
-- users.firebase_uid against the JWT sub, so it resolves for Firebase
-- subjects). The original mirror policy targeted `authenticated` only and
-- granted anon nothing: every entitlement read returned 42501 and a paid
-- Deckset Pro subscription never unlocked in the app.
--
-- Reads open to the company scope; writes remain service_role-only (the
-- Stripe webhook is the sole writer).

drop policy if exists deck_subscriptions_company_read
  on public.deck_subscriptions;
create policy deck_subscriptions_company_read
  on public.deck_subscriptions
  for select
  to public
  using (company_id = (select private.get_user_company_id()));

grant select on table public.deck_subscriptions to anon;

commit;
