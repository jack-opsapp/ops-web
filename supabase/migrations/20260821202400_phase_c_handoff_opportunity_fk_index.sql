begin;

create index if not exists phase_c_bilateral_event_handoffs_opportunity_idx
  on public.phase_c_bilateral_event_handoffs (opportunity_id);

commit;
