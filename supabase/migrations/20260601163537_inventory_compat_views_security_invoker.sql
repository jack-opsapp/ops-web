-- #2 security_definer_view (ERROR 0010): the six inventory_* backward-compat views over the
-- renamed catalog_* tables were SECURITY DEFINER, so reads bypassed catalog RLS and the anon key
-- could read every tenant's inventory. The underlying catalog_* tables already enforce
-- anon-compatible company isolation (policy role=public, company_id = private.get_user_company_id()),
-- so security_invoker makes the views honor that isolation for the querying session while preserving
-- the shipped iOS app's reads (its authenticated session resolves the helper -- proven by the live
-- expenses fix that uses the same helper). Write-through is handled by the iv_inventory_* INSTEAD OF
-- trigger functions, which are SECURITY DEFINER and unaffected by the view's invoker setting.
ALTER VIEW public.inventory_items          SET (security_invoker = true);
ALTER VIEW public.inventory_item_tags      SET (security_invoker = true);
ALTER VIEW public.inventory_tags           SET (security_invoker = true);
ALTER VIEW public.inventory_units          SET (security_invoker = true);
ALTER VIEW public.inventory_snapshots      SET (security_invoker = true);
ALTER VIEW public.inventory_snapshot_items SET (security_invoker = true);
