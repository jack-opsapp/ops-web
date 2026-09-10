-- Google Ads engine, phase 1 follow-up: admit campaign_shared_set rows into
-- the entity snapshot.
--
-- A negative-keyword list is attached to a campaign through the
-- campaign_shared_set resource. Without those rows the snapshot holds the
-- shared sets and the campaigns but nothing joining them, so the engine
-- cannot tell which list guards which campaign. The snapshot mapper keys on
-- the resource-name collection
-- (customers/<id>/campaignSharedSets/<campaign>~<set>), so only the stored
-- entity_type vocabulary has to widen.
--
-- Separate from 20260909123000_ads_warehouse_grain.sql because that file is
-- already applied to production (verified by object on 2026-09-09:
-- public.ads_entities exists carrying the nine-value check). Idempotent.

begin;

alter table public.ads_entities
  drop constraint if exists ads_entities_entity_type_check;

alter table public.ads_entities
  add constraint ads_entities_entity_type_check check (entity_type in (
    'campaign', 'campaign_budget', 'ad_group', 'ad', 'keyword',
    'negative_keyword', 'shared_set', 'shared_criterion',
    'campaign_shared_set', 'label'
  ));

commit;
