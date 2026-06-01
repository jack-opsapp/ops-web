-- 20260531200501_fix_payments_opportunities_permission_scope
-- Applied to ops-app (ijeekuhbatykdomumfjx) on 2026-05-31 via Supabase MCP.
-- Defense-in-depth follow-up to the Books "Mission Deck" review.
--
-- BEFORE: payments and opportunities were company-isolated but had NO permission
-- scoping, so a same-company authenticated user lacking invoices.view (payments)
-- or pipeline.view (opportunities) could read those rows via a direct query —
-- data the UI hides from them.
-- AFTER: add RESTRICTIVE read-scope. Both permissions only ever carry scope 'all'
-- (no own/assigned), and the app reads payments solely via the invoice embed
-- (already gated by invoices.view) and opportunities solely under pipeline.view —
-- so this cannot break a legitimate read.

CREATE POLICY role_scope_read ON public.payments
  AS RESTRICTIVE FOR SELECT TO public
  USING (private.current_user_has_permission('invoices.view'::text, 'all'::text));

CREATE POLICY role_scope_read ON public.opportunities
  AS RESTRICTIVE FOR SELECT TO public
  USING (private.current_user_has_permission('pipeline.view'::text, 'all'::text));
