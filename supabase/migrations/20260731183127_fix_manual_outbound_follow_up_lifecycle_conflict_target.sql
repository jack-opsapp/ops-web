-- Repository parity for the production hotfix applied on 2026-07-31.
-- The deployed function already uses the named primary-key constraint. This
-- migration fails closed if an unexpected definition is present and is safe to
-- replay against either the pre-fix or post-fix function.

begin;

do $hotfix$
declare
  v_signature regprocedure := to_regprocedure(
    'public.reconcile_manual_outbound_follow_up_cycle_as_system(uuid,uuid,text,text,timestamptz,text,text,text,text[],text[],text,uuid,uuid,uuid,timestamptz,text)'
  );
  v_definition text;
begin
  if v_signature is null then
    raise exception 'manual_outbound_follow_up_reconciliation_missing'
      using errcode = '55000';
  end if;

  select pg_get_functiondef(v_signature)
    into v_definition;

  if position(
    'on conflict on constraint opportunity_lifecycle_state_pkey do update'
    in lower(v_definition)
  ) = 0 then
    v_definition := regexp_replace(
      v_definition,
      'on[[:space:]]+conflict[[:space:]]*[(][[:space:]]*opportunity_id[[:space:]]*[)][[:space:]]+do[[:space:]]+update',
      'on conflict on constraint opportunity_lifecycle_state_pkey do update',
      'i'
    );

    if position(
      'on conflict on constraint opportunity_lifecycle_state_pkey do update'
      in lower(v_definition)
    ) = 0 then
      raise exception 'manual_outbound_follow_up_conflict_target_unrecognized'
        using errcode = '55000';
    end if;

    execute v_definition;
  end if;
end;
$hotfix$;

revoke all on function public.reconcile_manual_outbound_follow_up_cycle_as_system(
  uuid, uuid, text, text, timestamptz, text, text, text, text[], text[], text,
  uuid, uuid, uuid, timestamptz, text
) from public, anon, authenticated, service_role;

grant execute on function public.reconcile_manual_outbound_follow_up_cycle_as_system(
  uuid, uuid, text, text, timestamptz, text, text, text, text[], text[], text,
  uuid, uuid, uuid, timestamptz, text
) to service_role;

commit;
