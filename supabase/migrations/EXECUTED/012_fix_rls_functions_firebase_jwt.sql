-- Migration 012: Fix RLS helper functions for Firebase JWT compatibility
--
-- Problem: All three RLS helper functions used auth.uid() which expects
-- Supabase Auth's UUID-based sub claim. Firebase JWTs have non-UUID sub
-- values, causing all RLS policies to fail silently (returning no rows).
--
-- Fix: Switch all functions to use auth.jwt() ->> 'email' to look up
-- the user by email instead, which works with both Supabase Auth and
-- Firebase JWT tokens.
--
-- Also cleans up duplicate jack@opsapp.co user row from migration.
--
-- Executed: 2026-02-20

-- ============================================================================
-- 1. Fix private.get_user_company_id() — returns UUID
-- ============================================================================
CREATE OR REPLACE FUNCTION private.get_user_company_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT company_id FROM public.users
  WHERE email = (auth.jwt() ->> 'email')
    AND company_id IS NOT NULL
    AND deleted_at IS NULL
  LIMIT 1
$$;

-- ============================================================================
-- 2. Fix public.get_user_company_id() — returns TEXT
--    Must DROP CASCADE because feature_requests policy depends on it
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_user_company_id() CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT company_id::text FROM public.users
  WHERE email = (auth.jwt() ->> 'email')
    AND company_id IS NOT NULL
    AND deleted_at IS NULL
  LIMIT 1
$$;

-- Recreate policy dropped by CASCADE
CREATE POLICY "Admins can view company feature requests"
  ON public.feature_requests
  FOR SELECT
  USING (company_id = get_user_company_id() AND is_company_admin());

-- ============================================================================
-- 3. Fix public.get_user_id() — returns TEXT
--    Must DROP CASCADE because feature_requests policy depends on it
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_user_id() CASCADE;

CREATE OR REPLACE FUNCTION public.get_user_id()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
AS $$
  SELECT id::text FROM public.users
  WHERE email = (auth.jwt() ->> 'email')
    AND deleted_at IS NULL
  LIMIT 1
$$;

-- Recreate policy dropped by CASCADE
CREATE POLICY "Users can view own feature requests"
  ON public.feature_requests
  FOR SELECT
  USING (user_id = get_user_id());

-- ============================================================================
-- 4. Clean up duplicate jack@opsapp.co user
--    Seed row (correct bubble_id, dev_permission=true) was missing company_id
--    Migration row (wrong bubble_id with extra "00") had company_id set
--    Merge: update seed row with company_id, delete migration duplicate
-- ============================================================================
-- UPDATE users SET company_id = '82b04523-0fe6-455e-b14a-b3dd02fbc021'
--   WHERE id = '06a5973d-1507-4871-b170-2ae2ecef1257';
-- DELETE FROM users WHERE id = '90a6a106-f8ce-4558-93cf-2dc4046395e0';
-- (Data fix already applied manually, commented out for reference)
