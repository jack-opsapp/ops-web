-- 047_duplicate_reviews.sql
-- Stores detected duplicate pairs for user review.
-- entity_a_id < entity_b_id (lexicographic) to prevent storing same pair twice.

create table duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  entity_type text not null check (entity_type in ('client', 'opportunity', 'project', 'task')),
  entity_a_id uuid not null,
  entity_b_id uuid not null,
  confidence text not null check (confidence in ('high', 'medium')),
  signals jsonb not null default '[]',
  status text not null default 'pending' check (status in ('pending', 'merged', 'dismissed')),
  winner_id uuid,
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),

  constraint duplicate_reviews_ordered_pair check (entity_a_id < entity_b_id),
  constraint duplicate_reviews_unique_pair unique (company_id, entity_type, entity_a_id, entity_b_id)
);

-- Pending reviews per company (cron notification check)
create index idx_duplicate_reviews_pending
  on duplicate_reviews (company_id, status) where status = 'pending';

-- Dismissed pairs lookup during scan (skip permanently dismissed)
create index idx_duplicate_reviews_dismissed
  on duplicate_reviews (company_id, entity_type, entity_a_id, entity_b_id, status)
  where status = 'dismissed';

-- RLS: users can only see/update reviews for their company
alter table duplicate_reviews enable row level security;

create policy "Users can view own company reviews"
  on duplicate_reviews for select
  using (company_id in (
    select company_id from users where id = auth.uid()
  ));

create policy "Users can update own company reviews"
  on duplicate_reviews for update
  using (company_id in (
    select company_id from users where id = auth.uid()
  ));

-- Service role can insert (cron runs as service role)
create policy "Service role can insert"
  on duplicate_reviews for insert
  with check (true);
