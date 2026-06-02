-- QuickBooks import: customer fuzzy-match candidate finder.
-- Read-only. Returns existing non-deleted clients for a company ranked by
-- pg_trgm name similarity to a normalized QB DisplayName, above a threshold.
-- Used by computeCustomerMatches for the name_fuzzy step. pg_trgm is enabled
-- in migration A0.

create or replace function public.qbo_match_customer_candidates(
  p_company_id uuid,
  p_name text,
  p_threshold numeric default 0.6
)
returns table (
  client_id uuid,
  name text,
  email text,
  phone_number text,
  similarity numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id as client_id,
    c.name,
    c.email,
    c.phone_number,
    round(similarity(lower(c.name), lower(p_name))::numeric, 4) as similarity
  from clients c
  where c.company_id = p_company_id
    and c.deleted_at is null
    and c.merged_into_client_id is null
    and similarity(lower(c.name), lower(p_name)) >= p_threshold
  order by similarity(lower(c.name), lower(p_name)) desc
  limit 10;
$$;

revoke all on function public.qbo_match_customer_candidates(uuid, text, numeric) from public;
grant execute on function public.qbo_match_customer_candidates(uuid, text, numeric) to service_role;

comment on function public.qbo_match_customer_candidates(uuid, text, numeric) is
  'QBO import: read-only pg_trgm fuzzy match of QB customer name to existing clients (threshold default 0.6).';
