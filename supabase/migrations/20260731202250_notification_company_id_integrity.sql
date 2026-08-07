begin;

-- Keep the one historical malformed row available for an explicitly approved
-- repair while preventing every future notification from creating another
-- phantom tenant. NOT VALID enforces the check for new/updated rows without
-- rewriting or deleting existing customer data.
alter table public.notifications
  drop constraint if exists notifications_company_id_canonical;

alter table public.notifications
  add constraint notifications_company_id_canonical
  check (
    company_id is null
    or (
      company_id = btrim(company_id, E' \t\n\r')
      and company_id !~ '[[:cntrl:]]'
      and company_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  ) not valid;

commit;
