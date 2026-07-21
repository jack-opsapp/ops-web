-- Support restrictive foreign keys on the durable write-off receipt ledger.
-- The primary key begins with company_id, so project/user deletes otherwise
-- require a full receipt-table scan while checking referential integrity.
create index if not exists payment_review_writeoff_receipts_project_id_idx
  on public.payment_review_writeoff_receipts (project_id);

create index if not exists payment_review_writeoff_receipts_actor_user_id_idx
  on public.payment_review_writeoff_receipts (actor_user_id);
