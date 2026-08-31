begin;

create index if not exists agent_collections_change_sets_company_run_idx
  on private.agent_collections_change_sets (company_id, run_id);

create index if not exists agent_collections_receipts_company_change_set_idx
  on private.agent_collections_receipts (company_id, change_set_id);

create index if not exists agent_collections_receipts_company_run_idx
  on private.agent_collections_receipts (company_id, run_id);

commit;
