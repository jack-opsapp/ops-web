-- Supplier bill immutable-record privilege repair.
--
-- Supabase project default grants can give service_role UPDATE and DELETE on
-- newly created tables. The custody and audit tables are append-only by
-- contract, so remove inherited table privileges before restoring their narrow
-- server write surface.

begin;

revoke all on table public.supplier_bill_documents from service_role;
revoke all on table public.supplier_bill_events from service_role;

grant select, insert on table public.supplier_bill_documents to service_role;
grant select, insert on table public.supplier_bill_events to service_role;

commit;
