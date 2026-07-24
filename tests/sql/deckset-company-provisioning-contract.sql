begin;

insert into public.users (
  email,
  first_name,
  last_name,
  firebase_uid
)
values (
  'deckset-company-provisioning-contract@invalid.example',
  'Deckset',
  'Contract',
  'deckset-company-provisioning-contract'
);

select public.provision_deck_company(
  'deckset-company-provisioning-contract',
  'Deckset Contract',
  'deckset-company-provisioning-contract@invalid.example'
);

set constraints trg_user_roles_final_state immediate;

do $contract$
declare
  v_user_id uuid;
  v_company_id uuid;
begin
  select u.id, u.company_id
    into v_user_id, v_company_id
    from public.users u
   where u.firebase_uid = 'deckset-company-provisioning-contract'
     and u.deleted_at is null;

  if v_company_id is null then
    raise exception 'deckset_contract_failed: company_missing';
  end if;

  if not exists (
    select 1
      from public.companies c
     where c.id = v_company_id
       and c.account_holder_id = v_user_id::text
       and c.source_app = 'ops_decks'
       and c.deleted_at is null
  ) then
    raise exception 'deckset_contract_failed: company_invalid';
  end if;

  if not exists (
    select 1
      from public.users u
      join public.user_roles ur on ur.user_id = u.id::text
      join public.roles r on r.id = ur.role_id
     where u.id = v_user_id
       and u.company_id = v_company_id
       and u.role = 'owner'
       and u.is_company_admin
       and r.name = 'Owner'
       and r.is_preset
       and r.company_id is null
  ) then
    raise exception 'deckset_contract_failed: owner_invalid';
  end if;
end;
$contract$;

rollback;
