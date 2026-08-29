-- ═══════════════════════════════════════════════════════════════════════════
-- CLUSTER G — prod data repairs (bug sweep 2026-08-28)
--
-- NOT a migration. This file is reviewed and executed BY HAND by the PM; it is
-- deliberately outside supabase/migrations/ so it can never replay.
--
-- Company (Jackson's tenant): a612edc0-5c18-4c4d-af97-55b9410dd077
--
-- BEFORE RUNNING — every step is mandatory:
--   1. SELECT each targeted row and confirm the ids below still hold. These are
--      hard-coded prod ids captured on 2026-08-28; a merge or a delete since
--      then invalidates them.
--   2. Verify the operator row's shape for Repair 2's learning insert:
--        select id, email, company_id from public.users
--         where company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077';
--      Adjust the lookup columns if `users` does not carry email/company_id as
--      written.
--   3. Verify `lead_disposition_feedback`'s NOT NULL set against the live table
--      (every column used below was verified present 2026-08-28).
--   4. Run INSIDE A TRANSACTION and review the row counts before COMMIT.
--
-- The code fixes that prevent recurrence ship in the same branch; this file
-- only cleans up what the bugs already created.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── Repair 1: Elaine Beattie duplicate lead → Mark Vanderwerf's relationship ──
--
-- Root cause: Mark's sub-contact "Bruce And Elaine" had a NULL email, so the
-- exact-match tier could never see her and a duplicate client + opportunity
-- were created. Backfilling the email is what stops it happening again.

update public.sub_clients
   set email = 'bruceelainebeattie5@gmail.com', updated_at = now()
 where id = '46982414-40c9-490a-a840-15f13a66eabe' and email is null;

-- Re-home her correspondence onto Mark's won opportunity
update public.activities
   set opportunity_id = '7aad24fd-9695-4d65-b273-1da4222f7fcd'
 where opportunity_id = '4aad4e22-a847-4c74-8995-fae36d8c5ea8';

update public.opportunity_email_threads
   set opportunity_id = '7aad24fd-9695-4d65-b273-1da4222f7fcd'
 where opportunity_id = '4aad4e22-a847-4c74-8995-fae36d8c5ea8';

update public.email_threads
   set opportunity_id = '7aad24fd-9695-4d65-b273-1da4222f7fcd',
       client_id = '9fb202a8-df74-4d8b-b18f-af92b2ffc528'
 where opportunity_id = '4aad4e22-a847-4c74-8995-fae36d8c5ea8';

-- Retire the duplicate lead + client via the merge-aware soft-delete shape
update public.opportunities
   set deleted_at = now(),
       merged_into_opportunity_id = '7aad24fd-9695-4d65-b273-1da4222f7fcd'
 where id = '4aad4e22-a847-4c74-8995-fae36d8c5ea8';

update public.clients set deleted_at = now()
 where id = '4b46de3a-e7a1-477d-9dbd-c864e3c22f0f'
   and not exists (select 1 from public.opportunities
                    where client_id = '4b46de3a-e7a1-477d-9dbd-c864e3c22f0f' and deleted_at is null);

-- ── Repair 2: Sally Bushby landlord thread ──
--
-- Sally is the landlord of the company's OWN premises. Judged one message at a
-- time she looked like a customer with a property problem; the lane created a
-- client and an opportunity at 1.00 confidence.

update public.email_threads
   set primary_category = 'PERSONAL', category_manually_set = true,
       routing = 'update_lead_only',
       routing_reasons = array['Company landlord correspondence — reclassified by operator'],
       opportunity_id = null
 where id = '0ea449da-0675-4f4d-941b-89c6837f3158';

update public.opportunities
   set deleted_at = now()
 where id = 'cbb29a65-f812-4ac9-817d-99f82110462a';

update public.clients set deleted_at = now()
 where id = '904722c4-e1c6-4bf3-b98d-6d33f2408d02'
   and not exists (select 1 from public.opportunities
                    where client_id = '904722c4-e1c6-4bf3-b98d-6d33f2408d02' and deleted_at is null);

-- Learning row so the feedback prior suppresses future Sally-thread leads.
-- PM: verify the operator row's email/column names before running (see preamble).
insert into public.lead_disposition_feedback
  (company_id, opportunity_id, actor_user_id, reason_code, canonical_outcome,
   learning_polarity, learning_state, resolution_status, phase_c_enabled,
   prior_stage, source_provider_thread_id, sender_email, sender_domain,
   apply_idempotency_key)
select 'a612edc0-5c18-4c4d-af97-55b9410dd077',
       'cbb29a65-f812-4ac9-817d-99f82110462a',
       u.id, 'internal', 'discarded', 'negative', 'active', 'resolved', true,
       'negotiation',
       (select provider_thread_id from public.email_threads
         where id = '0ea449da-0675-4f4d-941b-89c6837f3158'),
       'sallyb@sleggs.com', 'sleggs.com',
       'cluster-g-sally-bushby-repair-2026-08-28'
  from public.users u
 where u.company_id = 'a612edc0-5c18-4c4d-af97-55b9410dd077'
   and u.email = 'j4ckson.sweet@gmail.com'  -- PM: verify the operator row's email/column names before running
 limit 1;

-- Review the affected row counts, then:
commit;
