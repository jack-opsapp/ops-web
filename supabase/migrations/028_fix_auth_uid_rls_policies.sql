-- Migration 028: Fix auth.uid() RLS policies for Firebase third-party auth
--
-- Problem: auth.uid() returns UUID type, casting the JWT 'sub' claim to UUID.
-- Firebase UIDs (e.g. "jxify3bspzs1uachdcvxf0qszvk2") are not valid UUIDs,
-- causing "invalid input syntax for type uuid" on any table whose RLS policy
-- calls auth.uid().
--
-- Fix: Replace all auth.uid() references with email-based lookups
-- (private.resolve_uid() / private.get_user_company_id()) which extract
-- the email from auth.jwt() and look up the user by email.

-- ─── bug_reports ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view bug reports for their company" ON bug_reports;
DROP POLICY IF EXISTS "Users can insert bug reports for their company" ON bug_reports;
DROP POLICY IF EXISTS "Users can update bug reports for their company" ON bug_reports;

CREATE POLICY "Users can view bug reports for their company"
  ON bug_reports FOR SELECT
  USING (company_id = private.get_user_company_id());

CREATE POLICY "Users can insert bug reports for their company"
  ON bug_reports FOR INSERT
  WITH CHECK (company_id = private.get_user_company_id());

CREATE POLICY "Users can update bug reports for their company"
  ON bug_reports FOR UPDATE
  USING (company_id = private.get_user_company_id());

-- ─── storage.objects (bug-reports bucket) ─────────────────────────────────────

DROP POLICY IF EXISTS "Company members can upload bug report files" ON storage.objects;
DROP POLICY IF EXISTS "Company members can read bug report files" ON storage.objects;

CREATE POLICY "Company members can upload bug report files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'bug-reports' AND auth.role() = 'authenticated');

CREATE POLICY "Company members can read bug report files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'bug-reports' AND auth.role() = 'authenticated');
