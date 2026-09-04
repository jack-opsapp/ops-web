-- OPS Public API: covering index for the booking-claim membership FK (P2-1).
--
-- `private.customer_booking_claims.membership_id` references
-- `private.company_client_memberships(id)` with ON DELETE SET NULL. Without a
-- covering index every membership delete has to scan the claims table to find
-- referencing rows, and the Supabase performance advisor flags it. The other
-- foreign keys added by 20260902190000_public_booking_foundation are already
-- covered by that migration's indexes; this one was not.
--
-- Partial on purpose: a claim without a membership carries no reference to
-- check, so those rows are dead weight in the index.

do $prerequisites$
begin
  if to_regclass('private.customer_booking_claims') is null then
    raise exception 'public_booking prerequisite missing: private.customer_booking_claims';
  end if;
end;
$prerequisites$;

create index if not exists customer_booking_claims_membership_idx
  on private.customer_booking_claims (membership_id)
  where membership_id is not null;
