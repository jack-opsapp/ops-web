-- Rehearsal-only: phase 1's warehouse contract (plan
-- docs/plans/2026-09-08-google-ads-engine-p1-measurement.md, Task 8, plus the
-- pre-existing ads_daily_account / ads_daily_campaign / ads_sync_status
-- tables) as plain tables, and a seeded live account for one rehearsal day
-- (Vancouver 2026-09-08). The real phase 1 migration replaces this file; the
-- engine only reads these shapes, never writes them.

create table public.admins (email text primary key);
insert into public.admins(email) values ('peterjmitchell1988@gmail.com');

insert into public.companies (id, name) values ('10000000-0000-4000-8000-000000000001', 'OPS Rehearsal');
insert into public.users (id, company_id, first_name, last_name, is_active)
  values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Jackson', 'Rehearsal', true);

create table public.ads_daily_account (
  date date primary key, spend numeric not null default 0, clicks integer not null default 0, impressions integer not null default 0,
  conversions numeric not null default 0, cpa numeric not null default 0, ctr numeric not null default 0, synced_at timestamptz not null default now());
create table public.ads_daily_campaign (
  date date not null, campaign_name text not null, campaign_status text not null default 'ENABLED', spend numeric not null default 0,
  clicks integer not null default 0, impressions integer not null default 0, conversions numeric not null default 0, cpa numeric not null default 0,
  ctr numeric not null default 0, synced_at timestamptz not null default now(), primary key (date, campaign_name));
create table public.ads_sync_status (
  id text primary key, status text not null default 'idle', last_synced_date date, backfill_progress jsonb, error text, updated_at timestamptz not null default now());
insert into public.ads_sync_status(id,status,last_synced_date) values ('daily-sync','complete','2026-09-07'),('backfill','complete','2026-09-07');

create table public.ads_daily_ad_group (
  date date not null, campaign_id text not null, campaign_name text not null, ad_group_id text not null, ad_group_name text not null, status text,
  spend numeric not null default 0, clicks integer not null default 0, impressions integer not null default 0, conversions numeric not null default 0,
  ctr numeric not null default 0, synced_at timestamptz not null default now(), primary key (date, ad_group_id));
create table public.ads_daily_ad (
  date date not null, ad_group_id text not null, ad_id text not null, ad_type text, status text, ad_strength text, approval_status text, review_status text,
  final_url text, spend numeric not null default 0, clicks integer not null default 0, impressions integer not null default 0, conversions numeric not null default 0,
  ctr numeric not null default 0, synced_at timestamptz not null default now(), primary key (date, ad_id));
create table public.ads_daily_asset (
  date date not null, ad_id text not null, asset_id text not null, field_type text not null, performance_label text, pinned_field text, text text,
  impressions integer not null default 0, clicks integer not null default 0, conversions numeric not null default 0, synced_at timestamptz not null default now(),
  primary key (date, ad_id, asset_id, field_type));
create table public.ads_daily_keyword (
  date date not null, campaign_id text, campaign_name text, ad_group_id text not null, ad_group_name text, criterion_id text not null, keyword text not null,
  match_type text not null, status text, quality_score integer, spend numeric not null default 0, clicks integer not null default 0, impressions integer not null default 0,
  conversions numeric not null default 0, average_cpc numeric not null default 0, synced_at timestamptz not null default now(), primary key (date, ad_group_id, criterion_id));
create table public.ads_entities (
  resource_name text primary key, entity_type text, parent_resource_name text, name text, status text, payload jsonb, labels text[], snapshot_at timestamptz not null default now());
create table public.ads_click_map (
  gclid text primary key, click_date date, campaign_id text, ad_group_id text, ad_id text, criterion_id text, keyword text, synced_at timestamptz not null default now());
create table public.ads_conversion_events (
  id uuid primary key default gen_random_uuid(), company_id uuid, kind text not null, occurred_at timestamptz not null, state text not null default 'queued',
  transaction_id text unique, created_at timestamptz not null default now());
-- The real object is a view over trial_attributions × ads_click_map; the engine only reads it.
create table public.ads_funnel_by_keyword (
  campaign_name text, ad_group_name text, keyword text, clicks integer, trials integer, activated integer, paid integer, spend numeric, cost_per_trial numeric, cost_per_paid numeric);

-- ─── Entities (Google camelCase resources, labels resolved to names) ────────
do $$
declare c text := 'customers/4454506598'; snap timestamptz := '2026-09-08T08:10:00Z';
begin
  insert into public.ads_entities(resource_name,entity_type,parent_resource_name,name,status,payload,labels,snapshot_at) values
  (c||'/labels/1','label',null,'engine',null,'{"id":"1","name":"engine"}','{}',snap),
  (c||'/labels/2','label',null,'legacy',null,'{"id":"2","name":"legacy"}','{}',snap),
  (c||'/labels/3','label',null,'role-control',null,'{"id":"3","name":"role-control"}','{}',snap),
  (c||'/labels/4','label',null,'role-challenger',null,'{"id":"4","name":"role-challenger"}','{}',snap),
  (c||'/campaignBudgets/1101','campaign_budget',null,'CORE · CA budget',null,'{"amountMicros":"32000000","deliveryMethod":"STANDARD"}','{}',snap),
  (c||'/campaignBudgets/1201','campaign_budget',null,'BRAND · CA budget',null,'{"amountMicros":"3000000","deliveryMethod":"STANDARD"}','{}',snap),
  (c||'/campaignBudgets/1301','campaign_budget',null,'COMPETITOR · CA budget',null,'{"amountMicros":"15000000","deliveryMethod":"STANDARD"}','{}',snap),
  (c||'/campaigns/11','campaign',null,'CORE · CA','ENABLED',('{"id":"11","name":"CORE · CA","status":"ENABLED","campaignBudget":"'||c||'/campaignBudgets/1101","biddingStrategyType":"MAXIMIZE_CLICKS","maximizeClicks":{"cpcBidCeilingMicros":"8000000"}}')::jsonb,'{engine}',snap),
  (c||'/campaigns/12','campaign',null,'BRAND · CA','ENABLED',('{"id":"12","name":"BRAND · CA","status":"ENABLED","campaignBudget":"'||c||'/campaignBudgets/1201","biddingStrategyType":"MANUAL_CPC"}')::jsonb,'{engine}',snap),
  (c||'/campaigns/13','campaign',null,'COMPETITOR · CA','ENABLED',('{"id":"13","name":"COMPETITOR · CA","status":"ENABLED","campaignBudget":"'||c||'/campaignBudgets/1301","biddingStrategyType":"MAXIMIZE_CLICKS","maximizeClicks":{"cpcBidCeilingMicros":"10000000"}}')::jsonb,'{engine}',snap),
  (c||'/campaigns/99','campaign',null,'Search - Bubble 2025','PAUSED','{"id":"99","name":"Search - Bubble 2025","status":"PAUSED","biddingStrategyType":"TARGET_SPEND"}','{legacy}',snap),
  (c||'/adGroups/21','ad_group',c||'/campaigns/11','Job management','ENABLED',('{"id":"21","name":"Job management","status":"ENABLED","campaign":"'||c||'/campaigns/11"}')::jsonb,'{}',snap),
  (c||'/adGroups/22','ad_group',c||'/campaigns/11','Crew scheduling','ENABLED',('{"id":"22","name":"Crew scheduling","status":"ENABLED","campaign":"'||c||'/campaigns/11"}')::jsonb,'{}',snap),
  (c||'/adGroups/23','ad_group',c||'/campaigns/11','Quotes & invoices','ENABLED',('{"id":"23","name":"Quotes & invoices","status":"ENABLED","campaign":"'||c||'/campaigns/11"}')::jsonb,'{}',snap),
  (c||'/adGroups/31','ad_group',c||'/campaigns/13','Jobber alternative','ENABLED',('{"id":"31","name":"Jobber alternative","status":"ENABLED","campaign":"'||c||'/campaigns/13"}')::jsonb,'{}',snap),
  (c||'/adGroups/41','ad_group',c||'/campaigns/12','Brand','ENABLED',('{"id":"41","name":"Brand","status":"ENABLED","campaign":"'||c||'/campaigns/12"}')::jsonb,'{}',snap);

  -- Ads: control + challenger in Job management (running test), controls elsewhere.
  insert into public.ads_entities(resource_name,entity_type,parent_resource_name,name,status,payload,labels,snapshot_at)
  select c||'/adGroupAds/'||g||'~'||a, 'ad_group_ad', c||'/adGroups/'||g, null, 'ENABLED',
    jsonb_build_object('adGroup', c||'/adGroups/'||g, 'status','ENABLED',
      'policySummary', jsonb_build_object('approvalStatus','APPROVED','reviewStatus','REVIEWED'),
      'ad', jsonb_build_object('id', a, 'finalUrls', jsonb_build_array(url),
        'responsiveSearchAd', jsonb_build_object(
          'headlines', jsonb_build_array(jsonb_build_object('text',h1,'pinnedField','HEADLINE_1'), jsonb_build_object('text',h2,'pinnedField','HEADLINE_1'),
            jsonb_build_object('text','No training required'), jsonb_build_object('text','Built by trades, for trades'), jsonb_build_object('text','Every feature, every tier'),
            jsonb_build_object('text','Free to start'), jsonb_build_object('text','Works offline in the field'), jsonb_build_object('text','Quotes and invoices in one')),
          'descriptions', jsonb_build_array(jsonb_build_object('text','One app your crew will actually use. No manual, no training.'),
            jsonb_build_object('text','Free to start. No credit card. Every feature on every tier.'),
            jsonb_build_object('text','Schedule jobs, track the crew and send invoices from the truck.')),
          'path1', p1, 'path2', p2))),
    array['engine','gen-p2', role], snap
  from (values
    ('21','201','https://try.opsapp.co/job-management','Job management for trades','Your crew opens it and goes','trades','jobs','role-control'),
    ('21','202','https://try.opsapp.co/job-management','Job management for crews','Every job in one place','trades','jobs','role-challenger'),
    ('22','203','https://try.opsapp.co/scheduling','Crew scheduling for trades','Everyone knows where to be','crews','schedule','role-control'),
    ('23','205','https://try.opsapp.co/quotes-invoices','Quotes and invoices for trades','Quote it, invoice it, done','quotes','invoices','role-control'),
    ('31','204','https://try.opsapp.co/compare/jobber','Jobber alternative for crews','Switching from Jobber?','jobber','alternative','role-control'),
    ('41','206','https://try.opsapp.co/','OPS job management','The app your crew opens','ops','app','role-control')
  ) as ads(g,a,url,h1,h2,p1,p2,role);

  insert into public.ads_entities(resource_name,entity_type,parent_resource_name,name,status,payload,labels,snapshot_at)
  select c||'/adGroupCriteria/'||g||'~'||k, 'ad_group_criterion', c||'/adGroups/'||g, text, 'ENABLED',
    jsonb_build_object('criterionId',k,'adGroup',c||'/adGroups/'||g,'status','ENABLED','negative',false,'type','KEYWORD','keyword',jsonb_build_object('text',text,'matchType',mt)), '{}', snap
  from (values
    ('21','101','job management app','PHRASE'),('21','102','job management software for trades','PHRASE'),('21','103','work order app','PHRASE'),
    ('22','111','crew scheduling app','PHRASE'),('22','112','scheduling software for trades','PHRASE'),
    ('23','121','invoicing app for trades','PHRASE'),('23','122','quote and invoice app','EXACT'),
    ('31','131','jobber alternative','EXACT'),('31','132','jobber alternatives','PHRASE'),
    ('41','141','opsapp','EXACT'),('41','142','ops app','EXACT')
  ) as kw(g,k,text,mt);

  insert into public.ads_entities(resource_name,entity_type,parent_resource_name,name,status,payload,labels,snapshot_at) values
  (c||'/sharedSets/501','shared_set',null,'NEG · Job seekers','ENABLED','{"id":"501","name":"NEG · Job seekers","type":"NEGATIVE_KEYWORDS","status":"ENABLED"}','{}',snap),
  (c||'/sharedSets/502','shared_set',null,'NEG · Homeowner intent','ENABLED','{"id":"502","name":"NEG · Homeowner intent","type":"NEGATIVE_KEYWORDS","status":"ENABLED"}','{}',snap),
  (c||'/sharedSets/503','shared_set',null,'NEG · Training','ENABLED','{"id":"503","name":"NEG · Training","type":"NEGATIVE_KEYWORDS","status":"ENABLED"}','{}',snap),
  (c||'/sharedSets/504','shared_set',null,'NEG · Generic waste','ENABLED','{"id":"504","name":"NEG · Generic waste","type":"NEGATIVE_KEYWORDS","status":"ENABLED"}','{}',snap),
  (c||'/sharedSets/505','shared_set',null,'NEG · Wrong segment','ENABLED','{"id":"505","name":"NEG · Wrong segment","type":"NEGATIVE_KEYWORDS","status":"ENABLED"}','{}',snap);
  insert into public.ads_entities(resource_name,entity_type,parent_resource_name,name,status,payload,labels,snapshot_at)
  select c||'/sharedCriteria/'||s||'~'||i, 'shared_criterion', c||'/sharedSets/'||s, text, null,
    jsonb_build_object('sharedSet',c||'/sharedSets/'||s,'criterionId',i,'keyword',jsonb_build_object('text',text,'matchType','BROAD')), '{}', snap
  from (values ('501','1','jobs'),('501','2','hiring'),('501','3','salary'),('502','1','near me'),('502','2','hire'),('503','1','course'),('503','2','certification'),('504','1','excel'),('504','2','template'),('505','1','enterprise'),('505','2','servicetitan')) as m(s,i,text);
  insert into public.ads_entities(resource_name,entity_type,parent_resource_name,name,status,payload,labels,snapshot_at)
  select c||'/campaignSharedSets/'||cid||'~'||s, 'campaign_shared_set', c||'/campaigns/'||cid, null, null,
    jsonb_build_object('campaign',c||'/campaigns/'||cid,'sharedSet',c||'/sharedSets/'||s), '{}', snap
  from (values ('11'),('12'),('13')) as camp(cid) cross join (values ('501'),('502'),('503'),('504'),('505')) as sets(s);
end $$;

-- ─── Daily grains, 2026-08-01 → 2026-09-07 (the trailing three days are excluded by the engine) ──
do $$
declare d date; i integer := 0; w numeric;
begin
  for d in select generate_series('2026-08-01'::date, '2026-09-07'::date, '1 day') loop
    i := i + 1; w := 1 + ((i * 7) % 5) * 0.08;  -- deterministic daily wobble
    insert into public.ads_daily_campaign(date,campaign_name,campaign_status,spend,clicks,impressions,conversions,ctr) values
      (d,'CORE · CA','ENABLED',round(31.2*w,2),round(9*w),round(310*w),case when i % 9 = 0 then 1 else 0 end,0.029),
      (d,'BRAND · CA','ENABLED',round(2.4*w,2),round(3*w),round(28*w),case when i % 19 = 0 then 1 else 0 end,0.10),
      (d,'COMPETITOR · CA','ENABLED',round(13.9*w,2),round(3*w),round(95*w),0,0.031);
    insert into public.ads_daily_account(date,spend,clicks,impressions,conversions,ctr) values
      (d,round(47.5*w,2),round(15*w),round(433*w),case when i % 9 = 0 then 1 else 0 end + case when i % 19 = 0 then 1 else 0 end,0.034);
    insert into public.ads_daily_ad_group(date,campaign_id,campaign_name,ad_group_id,ad_group_name,status,spend,clicks,impressions,conversions,ctr) values
      (d,'11','CORE · CA','21','Job management','ENABLED',round(15.1*w,2),round(4*w),round(140*w),case when i % 9 = 0 then 1 else 0 end,0.029),
      (d,'11','CORE · CA','22','Crew scheduling','ENABLED',round(9.6*w,2),round(3*w),round(100*w),0,0.03),
      (d,'11','CORE · CA','23','Quotes & invoices','ENABLED',round(6.5*w,2),round(2*w),round(70*w),0,0.029),
      (d,'13','COMPETITOR · CA','31','Jobber alternative','ENABLED',round(13.9*w,2),round(3*w),round(95*w),0,0.031),
      (d,'12','BRAND · CA','41','Brand','ENABLED',round(2.4*w,2),round(3*w),round(28*w),case when i % 19 = 0 then 1 else 0 end,0.10);
    -- Ads: the Job management pair started its test on 2026-08-25; the challenger runs from that day.
    insert into public.ads_daily_ad(date,ad_group_id,ad_id,ad_type,status,ad_strength,approval_status,review_status,final_url,spend,clicks,impressions,conversions,ctr) values
      (d,'21','201','RESPONSIVE_SEARCH_AD','ENABLED','GOOD','APPROVED','REVIEWED','https://try.opsapp.co/job-management',round(case when d < '2026-08-25' then 15.1 else 7.8 end * w,2),round(case when d < '2026-08-25' then 4 else 2 end * w),round(case when d < '2026-08-25' then 140 else 72 end * w),case when i % 9 = 0 then 1 else 0 end,0.028),
      (d,'22','203','RESPONSIVE_SEARCH_AD','ENABLED','GOOD','APPROVED','REVIEWED','https://try.opsapp.co/scheduling',round(9.6*w,2),round(3*w),round(100*w),0,0.03),
      (d,'23','205','RESPONSIVE_SEARCH_AD','ENABLED','AVERAGE','APPROVED','REVIEWED','https://try.opsapp.co/quotes-invoices',round(6.5*w,2),round(2*w),round(70*w),0,0.029),
      (d,'31','204','RESPONSIVE_SEARCH_AD','ENABLED','GOOD','APPROVED','REVIEWED','https://try.opsapp.co/compare/jobber',round(13.9*w,2),round(3*w),round(95*w),0,0.031),
      (d,'41','206','RESPONSIVE_SEARCH_AD','ENABLED','EXCELLENT','APPROVED','REVIEWED','https://try.opsapp.co/',round(2.4*w,2),round(3*w),round(28*w),case when i % 19 = 0 then 1 else 0 end,0.10);
    if d >= '2026-08-25' then
      insert into public.ads_daily_ad(date,ad_group_id,ad_id,ad_type,status,ad_strength,approval_status,review_status,final_url,spend,clicks,impressions,conversions,ctr) values
        (d,'21','202','RESPONSIVE_SEARCH_AD','ENABLED','GOOD','APPROVED','REVIEWED','https://try.opsapp.co/job-management',round(7.3*w,2),round(3*w),round(68*w),0,0.044);
    end if;
    insert into public.ads_daily_keyword(date,campaign_id,campaign_name,ad_group_id,ad_group_name,criterion_id,keyword,match_type,status,quality_score,spend,clicks,impressions,conversions,average_cpc) values
      (d,'11','CORE · CA','21','Job management','101','job management app','PHRASE','ENABLED',7,round(6.2*w,2),round(2*w),round(60*w),case when i % 9 = 0 then 1 else 0 end,3.1),
      (d,'11','CORE · CA','21','Job management','102','job management software for trades','PHRASE','ENABLED',6,round(4.1*w,2),round(1*w),round(40*w),0,4.1),
      (d,'11','CORE · CA','21','Job management','103','work order app','PHRASE','ENABLED',4,round(4.8*w,2),round(1*w),round(40*w),0,4.8),
      (d,'11','CORE · CA','22','Crew scheduling','111','crew scheduling app','PHRASE','ENABLED',7,round(6.4*w,2),round(2*w),round(66*w),0,3.2),
      (d,'11','CORE · CA','22','Crew scheduling','112','scheduling software for trades','PHRASE','ENABLED',6,round(3.2*w,2),round(1*w),round(34*w),0,3.2),
      (d,'11','CORE · CA','23','Quotes & invoices','121','invoicing app for trades','PHRASE','ENABLED',6,round(4.3*w,2),round(1*w),round(46*w),0,4.3),
      (d,'11','CORE · CA','23','Quotes & invoices','122','quote and invoice app','EXACT','ENABLED',7,round(2.2*w,2),round(1*w),round(24*w),0,2.2),
      (d,'13','COMPETITOR · CA','31','Jobber alternative','131','jobber alternative','EXACT','ENABLED',8,round(9.4*w,2),round(2*w),round(60*w),0,4.7),
      (d,'13','COMPETITOR · CA','31','Jobber alternative','132','jobber alternatives','PHRASE','ENABLED',7,round(4.5*w,2),round(1*w),round(35*w),0,4.5),
      (d,'12','BRAND · CA','41','Brand','141','opsapp','EXACT','ENABLED',10,round(1.4*w,2),round(2*w),round(18*w),case when i % 19 = 0 then 1 else 0 end,0.7),
      (d,'12','BRAND · CA','41','Brand','142','ops app','EXACT','ENABLED',9,round(1.0*w,2),round(1*w),round(10*w),0,1.0);
    -- Search terms: the good ones convert; the junk never does.
    insert into public.ads_daily_search_term(date,search_term,campaign_name,ad_group_name,spend,clicks,impressions,conversions,cpa,ctr,waste_flag) values
      (d,'job management app','CORE · CA','Job management',round(5.1*w,2),round(1.6*w),round(48*w),case when i % 9 = 0 then 1 else 0 end,0,0.033,null),
      (d,'crew scheduling app','CORE · CA','Crew scheduling',round(4.8*w,2),round(1.5*w),round(50*w),0,0,0.03,null),
      (d,'job management jobs','CORE · CA','Job management',case when i % 6 = 0 then 4.4 else 0 end,case when i % 6 = 0 then 1 else 0 end,round(6*w),0,0,0.02,null),
      (d,'job management course','CORE · CA','Job management',case when i % 8 = 0 then 3.9 else 0 end,case when i % 8 = 0 then 1 else 0 end,round(5*w),0,0,0.02,null),
      (d,'jobber careers','COMPETITOR · CA','Jobber alternative',case when i % 12 = 0 then 4.7 else 0 end,case when i % 12 = 0 then 1 else 0 end,round(4*w),0,0,0.02,null),
      (d,'electrician near me','CORE · CA','Job management',case when i % 5 = 0 then 3.2 else 0 end,case when i % 5 = 0 then 1 else 0 end,round(9*w),0,0,0.02,null),
      (d,'free job management app','CORE · CA','Job management',case when i % 4 = 0 then 3.5 else 0 end,case when i % 4 = 0 then 1 else 0 end,round(12*w),0,0,0.02,null);
  end loop;
  -- Asset performance labels on the Job management control (latest day only is read).
  insert into public.ads_daily_asset(date,ad_id,asset_id,field_type,performance_label,pinned_field,text,impressions,clicks) values
    ('2026-09-05','201','9001','HEADLINE','BEST','HEADLINE_1','Job management for trades',1800,60),
    ('2026-09-05','201','9002','HEADLINE','GOOD','HEADLINE_1','Your crew opens it and goes',1700,52),
    ('2026-09-05','201','9003','HEADLINE','LOW',null,'Every feature, every tier',900,12);
end $$;

-- ─── Ledger seeds: one running test, a few sent conversions, a funnel ───────
insert into public.ads_tests(id,campaign_id,ad_group_id,ad_group_name,control_ad_id,challenger_ad_id,label,started_at,state)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11','21','Job management','201','202','gen-p2','2026-08-25T15:00:00Z','running');
insert into public.ads_conversion_events(company_id,kind,occurred_at,state,transaction_id) values
  ('10000000-0000-4000-8000-000000000001','trial_started','2026-08-19T18:00:00Z','sent','trial_started:a'),
  ('10000000-0000-4000-8000-000000000001','trial_started','2026-08-28T18:00:00Z','sent','trial_started:b'),
  ('10000000-0000-4000-8000-000000000001','trial_started','2026-09-04T18:00:00Z','sent','trial_started:c');
insert into public.ads_funnel_by_keyword values
  ('CORE · CA','Job management','job management app',72,3,1,0,220.4,73.47,null),
  ('CORE · CA','Job management','job management software for trades',38,0,0,0,152.1,null,null),
  ('CORE · CA','Job management','work order app',36,0,0,0,150.3,null,null),
  ('CORE · CA','Crew scheduling','crew scheduling app',70,1,0,0,231.8,231.8,null),
  ('COMPETITOR · CA','Jobber alternative','jobber alternative',66,1,1,1,340.2,340.2,340.2),
  ('BRAND · CA','Brand','opsapp',60,2,1,0,51.4,25.7,null);
