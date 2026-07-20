-- Leads redesign (iOS FILES section): the only SELECT policy on
-- email_attachments keys off a company_id JWT claim, which the iOS
-- Firebase-JWT bridge does not carry — iOS reads returned zero rows.
-- Additive second SELECT policy for ATTRIBUTED lead files, keyed to the
-- same row authority as the lead itself (mirrors the web route's
-- canViewAttributedLeadFile gate: attributed + opportunity_id + can view
-- the lead). Web service-role reads bypass RLS and are unaffected.
CREATE POLICY email_attachments_lead_files_select ON public.email_attachments
FOR SELECT TO public USING (
  attribution_status = 'attributed'
  AND opportunity_id IS NOT NULL
  AND private.current_user_can_view_opportunity(opportunity_id)
);
