begin;

-- ─── companies.source_app — deck-only origin marker ─────────────────────────
--
-- The Phase-1 Deckset backend contract requires a clear deck-only origin
-- field so the main OPS app can route a Deckset-born company to upgrade
-- instead of treating it as a lapsed OPS subscription.
-- companies.subscription_plan cannot host this: its CHECK constraint pins
-- OPS plans ('trial','starter','team','business') and the contract forbids
-- deck entitlement in companies.subscription_*.
--
-- Additive with a default — safe for shipped iOS builds and existing rows
-- (all 'ops').

alter table public.companies
  add column if not exists source_app text not null default 'ops';

alter table public.companies
  drop constraint if exists companies_source_app_check;
alter table public.companies
  add constraint companies_source_app_check
  check (source_app in ('ops', 'ops_decks'));

comment on column public.companies.source_app is
  'Product that created the company: ops (default) or ops_decks (Deckset standalone provisioning). Routing marker only — never a billing state.';

-- ─── provision_deck_company — server-only provisioning wrapper ──────────────
--
-- create_company_for_owner is the hardened single path for company-of-one
-- creation (per-caller advisory lock, TOCTOU re-read, unique company code,
-- Owner preset role seed, initialize_company_defaults) but derives the
-- caller from auth.jwt()->>'sub' and is deliberately NOT executable by anon.
-- The Deckset provisioning route verifies the Firebase ID token
-- cryptographically server-side, so this wrapper accepts the verified
-- subject explicitly, injects it transaction-locally (the same GUC technique
-- create_company_for_owner itself uses to elevate for
-- initialize_company_defaults), and stamps the deck origin in the same
-- transaction. EXECUTE is service_role-only.

create or replace function public.provision_deck_company(
  p_firebase_uid text,
  p_company_name text,
  p_email text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_prior_claim  text;
  v_prior_claims text;
  v_injected     text;
  v_result       jsonb;
  v_company_id   uuid;
  v_user         users%rowtype;
begin
  if p_firebase_uid is null or btrim(p_firebase_uid) = '' then
    raise exception 'NO_FIREBASE_UID' using errcode = 'P0001';
  end if;

  -- On RAISE inside create_company_for_owner the transaction aborts and the
  -- transaction-local GUCs revert with it — explicit restore is only needed
  -- on the success path (same contract as the wrapped function's own
  -- elevation block).
  v_prior_claim  := current_setting('request.jwt.claim', true);
  v_prior_claims := current_setting('request.jwt.claims', true);
  v_injected := jsonb_build_object('sub', p_firebase_uid)::text;
  perform set_config('request.jwt.claim',  v_injected, true);
  perform set_config('request.jwt.claims', v_injected, true);

  v_result := public.create_company_for_owner(p_company_name, null, p_email, null, null);

  perform set_config('request.jwt.claim',  coalesce(v_prior_claim, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_prior_claims, ''), true);

  v_company_id := (v_result ->> 'company_id')::uuid;

  -- Stamp the deck origin only on companies THIS call created; an
  -- already_existed result is a pre-existing OPS company and keeps its
  -- origin. subscription_* is never written here — the platform trial
  -- trigger applies its uniform defaults and Deckset entitlement lives
  -- exclusively in deck_subscriptions.
  if not coalesce((v_result ->> 'already_existed')::boolean, false) then
    update public.companies
       set source_app = 'ops_decks'
     where id = v_company_id;
  end if;

  select * into v_user
    from public.users
   where firebase_uid = p_firebase_uid
     and deleted_at is null
   limit 1;

  return v_result || jsonb_build_object(
    'user_id', v_user.id,
    'role', coalesce(v_user.role, 'owner')
  );
end $$;

revoke all on function public.provision_deck_company(text, text, text)
  from public, anon, authenticated;
grant execute on function public.provision_deck_company(text, text, text)
  to service_role;

commit;
