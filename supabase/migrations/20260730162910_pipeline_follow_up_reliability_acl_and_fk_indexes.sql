begin;

revoke all on function private.guard_template_follow_up_cycle()
  from public, anon, authenticated, service_role;

create index email_ingestion_recovery_queue_opportunity_idx
  on public.email_ingestion_recovery_queue (
    company_id,
    opportunity_id
  );

create index opportunity_manual_outbound_cycle_receipts_correspondence_idx
  on public.opportunity_manual_outbound_cycle_receipts (
    company_id,
    correspondence_event_id
  );

create index opportunity_manual_outbound_cycle_receipts_activity_idx
  on public.opportunity_manual_outbound_cycle_receipts (
    company_id,
    activity_id
  );

commit;
