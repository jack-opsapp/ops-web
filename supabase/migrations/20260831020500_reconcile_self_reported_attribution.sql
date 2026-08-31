begin;

-- Keep the customer's raw answer separate from deterministic first touch.
-- Only the seven stable onboarding slugs classify here; Bubble-era free text
-- remains raw and is normalized at read time without rewriting history.
create or replace function public.stamp_company_self_reported_attribution()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_source text := nullif(btrim(new.referral_method), '');
  v_channel text;
begin
  v_channel := case v_source
    when 'instagram' then 'organic_social'
    when 'facebook' then 'organic_social'
    when 'youtube' then 'organic_social'
    when 'google' then 'organic_search'
    when 'app_store' then 'app_store_browse'
    when 'word_of_mouth' then 'referral'
    when 'other' then 'other'
    else null
  end;

  update public.trial_attributions ta
     set self_reported_source = v_source,
         attributed_channel = case
           when ta.attribution_basis not in ('unknown', 'self_reported')
             or (
               ta.attributed_channel <> 'unknown'
               and ta.attribution_basis <> 'self_reported'
             ) then ta.attributed_channel
           when v_channel is null then 'unknown'
           else v_channel
         end,
         attribution_basis = case
           when ta.attribution_basis not in ('unknown', 'self_reported')
             or (
               ta.attributed_channel <> 'unknown'
               and ta.attribution_basis <> 'self_reported'
             ) then ta.attribution_basis
           when v_channel is null then 'unknown'
           else 'self_reported'
         end,
         attribution_confidence = case
           when ta.attribution_basis not in ('unknown', 'self_reported')
             or (
               ta.attributed_channel <> 'unknown'
               and ta.attribution_basis <> 'self_reported'
             ) then ta.attribution_confidence
           when v_channel is null then null
           else 0.550
         end,
         classification_reason = case
           when ta.attribution_basis not in ('unknown', 'self_reported')
             or (
               ta.attributed_channel <> 'unknown'
               and ta.attribution_basis <> 'self_reported'
             ) then ta.classification_reason
           when v_source is null then 'self_reported_blank'
           when v_channel is null then 'self_reported_unmapped'
           else 'self_reported_' || v_source
         end,
         updated_at = now()
   where ta.company_id = new.id;

  return new;
exception when others then
  -- Acquisition telemetry must never abort company creation or onboarding.
  raise warning 'stamp_company_self_reported_attribution failed for company %: %',
    new.id, sqlerrm;
  return new;
end
$function$;

revoke all on function public.stamp_company_self_reported_attribution()
  from public, anon, authenticated;

drop trigger if exists companies_stamp_self_reported_attribution_on_insert
  on public.companies;
create trigger companies_stamp_self_reported_attribution_on_insert
  after insert on public.companies
  for each row execute function public.stamp_company_self_reported_attribution();

drop trigger if exists companies_stamp_self_reported_attribution_on_update
  on public.companies;
create trigger companies_stamp_self_reported_attribution_on_update
  after update of referral_method on public.companies
  for each row
  when (old.referral_method is distinct from new.referral_method)
  execute function public.stamp_company_self_reported_attribution();

-- Populate the raw side-channel for existing companies without changing the
-- customer-authored companies.referral_method value. Stable slugs can be
-- classified; legacy values stay explicitly unknown until read-time mapping.
with normalized as (
  select
    c.id as company_id,
    nullif(btrim(c.referral_method), '') as raw_source,
    case nullif(btrim(c.referral_method), '')
      when 'instagram' then 'organic_social'
      when 'facebook' then 'organic_social'
      when 'youtube' then 'organic_social'
      when 'google' then 'organic_search'
      when 'app_store' then 'app_store_browse'
      when 'word_of_mouth' then 'referral'
      when 'other' then 'other'
      else null
    end as canonical_channel
  from public.companies c
)
update public.trial_attributions ta
   set self_reported_source = n.raw_source,
       attributed_channel = case
         when ta.attribution_basis not in ('unknown', 'self_reported')
           or (
             ta.attributed_channel <> 'unknown'
             and ta.attribution_basis <> 'self_reported'
           ) then ta.attributed_channel
         when n.canonical_channel is null then 'unknown'
         else n.canonical_channel
       end,
       attribution_basis = case
         when ta.attribution_basis not in ('unknown', 'self_reported')
           or (
             ta.attributed_channel <> 'unknown'
             and ta.attribution_basis <> 'self_reported'
           ) then ta.attribution_basis
         when n.canonical_channel is null then 'unknown'
         else 'self_reported'
       end,
       attribution_confidence = case
         when ta.attribution_basis not in ('unknown', 'self_reported')
           or (
             ta.attributed_channel <> 'unknown'
             and ta.attribution_basis <> 'self_reported'
           ) then ta.attribution_confidence
         when n.canonical_channel is null then null
         else 0.550
       end,
       classification_reason = case
         when ta.attribution_basis not in ('unknown', 'self_reported')
           or (
             ta.attributed_channel <> 'unknown'
             and ta.attribution_basis <> 'self_reported'
           ) then ta.classification_reason
         when n.raw_source is null then 'self_reported_blank'
         when n.canonical_channel is null then 'self_reported_unmapped'
         else 'self_reported_' || n.raw_source
       end,
       updated_at = now()
  from normalized n
 where ta.company_id = n.company_id;

commit;
