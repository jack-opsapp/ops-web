begin;

-- Cover every Phase C relationship used by FK validation and cascade paths.
create index if not exists opportunity_phase_c_work_company_opportunity_idx
  on public.opportunity_phase_c_work (company_id, opportunity_id);
create index if not exists opportunity_phase_c_work_company_event_idx
  on public.opportunity_phase_c_work (company_id, required_event_id);
create index if not exists opportunity_phase_c_work_activity_idx
  on public.opportunity_phase_c_work (required_activity_id);
create index if not exists opportunity_phase_c_work_summary_event_idx
  on public.opportunity_phase_c_work (summary_completed_event_id);
create index if not exists opportunity_phase_c_work_lifecycle_event_idx
  on public.opportunity_phase_c_work (lifecycle_completed_event_id);
create index if not exists opportunity_phase_c_work_commercial_event_idx
  on public.opportunity_phase_c_work (commercial_completed_event_id);
create index if not exists opportunity_phase_c_work_handoff_event_idx
  on public.opportunity_phase_c_work (event_handoff_completed_event_id);

create index if not exists opportunity_lifecycle_decisions_company_opportunity_idx
  on public.opportunity_lifecycle_decisions (company_id, opportunity_id);
create index if not exists opportunity_lifecycle_decisions_company_source_event_idx
  on public.opportunity_lifecycle_decisions (company_id, source_event_id);

create index if not exists phase_c_bilateral_event_handoffs_decision_idx
  on public.phase_c_bilateral_event_handoffs (decision_id);
create index if not exists phase_c_bilateral_event_handoffs_company_opportunity_idx
  on public.phase_c_bilateral_event_handoffs (company_id, opportunity_id);
create index if not exists phase_c_bilateral_event_handoffs_company_proposal_idx
  on public.phase_c_bilateral_event_handoffs (company_id, proposal_event_id);
create index if not exists phase_c_bilateral_event_handoffs_company_acceptance_idx
  on public.phase_c_bilateral_event_handoffs (company_id, acceptance_event_id);
create index if not exists phase_c_bilateral_event_handoffs_owner_idx
  on public.phase_c_bilateral_event_handoffs (requested_owner_user_id);

commit;
