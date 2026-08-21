-- Keep lead-conversion candidate RPCs available only to signed-in operators.

begin;

revoke all on function public.get_manual_project_link_candidates(uuid)
  from public, anon;
grant execute on function public.get_manual_project_link_candidates(uuid)
  to authenticated;

revoke all on function public.get_opportunity_conversion_photo_candidates(uuid)
  from public, anon;
grant execute on function public.get_opportunity_conversion_photo_candidates(uuid)
  to authenticated;

commit;
