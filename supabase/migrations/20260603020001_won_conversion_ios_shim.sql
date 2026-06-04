-- Won → Project Conversion: iOS shim (applied AFTER 20260603020000 is sentinel-proven)
--
-- Rewrites the legacy convert_lead_to_project as a thin shim over the unified
-- convert_opportunity_to_project so old iOS clients in the field converge on the
-- new logic with NO App Store release. This is the ONE live-path behavior change
-- in the initiative — kept separate so it lands only after the unified RPC is
-- verified on prod. Preserves the (uuid) return + the original error codes.
-- Operator-typed p_title ⇒ title_override ⇒ hand-set (title_is_auto = false).

create or replace function public.convert_lead_to_project(
  p_opportunity_id uuid,
  p_actual_value numeric,
  p_title text,
  p_address text,
  p_user_id uuid
) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare v_company uuid; v_result jsonb;
begin
  select company_id into v_company from public.opportunities
   where id = p_opportunity_id and deleted_at is null;
  if v_company is null then raise exception 'opportunity_not_found' using errcode='P0002'; end if;

  v_result := public.convert_opportunity_to_project(
    p_company_id := v_company,
    p_opportunity_id := p_opportunity_id,
    p_actual_value := p_actual_value,
    p_decided_by := p_user_id,
    p_title_override := p_title,
    p_source_path := 'ios',
    p_win_opportunity := true,
    p_evidence := jsonb_build_object('legacy_shim', true)
  );
  return (v_result->>'project_id')::uuid;
end;
$$;
