-- Fix: RLS function must resolve Bubble ID from Firebase JWT to Supabase UUID.
-- Firebase custom claims contain the Bubble company ID (e.g. "1748465773440x642579687246238300"),
-- but all company_id columns are UUID referencing companies(id).
-- This function looks up the UUID via the companies.bubble_id column.

CREATE OR REPLACE FUNCTION private.get_user_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' AS $$
  SELECT id FROM public.companies
  WHERE bubble_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')
  LIMIT 1
$$;
