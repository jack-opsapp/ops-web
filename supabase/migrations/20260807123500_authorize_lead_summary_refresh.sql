-- Actor-scoped authorization boundary for an on-demand Phase C summary
-- refresh after the iOS app has durably logged a lead activity.

create or replace function public.authorize_lead_summary_refresh(
  p_opportunity_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor_user_id uuid := private.get_current_user_id();
  v_company_id uuid;
begin
  if v_actor_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select opportunity.company_id
    into v_company_id
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.deleted_at is null
    and opportunity.merged_into_opportunity_id is null;

  if v_company_id is null then
    raise exception 'opportunity not found' using errcode = 'P0002';
  end if;

  if not private.user_can_edit_opportunity(
    v_actor_user_id,
    p_opportunity_id
  ) then
    raise exception 'opportunity access denied' using errcode = '42501';
  end if;

  return v_company_id;
end;
$$;

revoke all on function public.authorize_lead_summary_refresh(uuid) from public;
grant execute on function public.authorize_lead_summary_refresh(uuid) to authenticated;
