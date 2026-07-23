ALTER TABLE public.activities
  ADD CONSTRAINT activities_type_check_v2
  CHECK (
    type IN (
      'note',
      'email',
      'call',
      'meeting',
      'estimate_sent',
      'estimate_accepted',
      'estimate_declined',
      'invoice_sent',
      'payment_received',
      'stage_change',
      'created',
      'won',
      'lost',
      'system',
      'site_visit',
      'site_visit_scheduled',
      'text_message',
      'email_compose'
    )
  )
  NOT VALID;

ALTER TABLE public.activities
  VALIDATE CONSTRAINT activities_type_check_v2;

ALTER TABLE public.activities
  DROP CONSTRAINT activities_type_check;

ALTER TABLE public.activities
  RENAME CONSTRAINT activities_type_check_v2
  TO activities_type_check;
