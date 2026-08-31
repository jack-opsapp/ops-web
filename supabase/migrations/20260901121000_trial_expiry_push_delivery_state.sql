begin;

-- Bug 60480c86: the trial-expiry claim row is bundle-scoped (email + push +
-- in-app). A OneSignal invalid_aliases failure after the claim permanently
-- suppressed the push with zero recorded errors. These columns give the push
-- leg its own durable outcome so the daily cron can retry eligible failures
-- without ever re-sending the emails the claim already covers.
alter table public.trial_expiry_notifications
  add column push_status text not null default 'none',
  add column push_attempts integer not null default 0,
  add column push_last_error text,
  add column push_last_attempt_at timestamptz;

alter table public.trial_expiry_notifications
  add constraint trial_expiry_notifications_push_status_check
  check (push_status in ('none','not_applicable','sent','skipped_quiet_hours','retry_eligible','failed'));

alter table public.trial_expiry_notifications
  add constraint trial_expiry_notifications_push_attempts_check
  check (push_attempts >= 0 and push_attempts <= 10);

comment on column public.trial_expiry_notifications.push_status is
  'Durable outcome of the push leg only. none = pre-dates this column; not_applicable = this notification type never pushes; sent = provider created the notification; skipped_quiet_hours = every recipient was in quiet hours (forgone by design — email and in-app still carried the message); retry_eligible = provider send failed and a later daily run may try again; failed = retry budget exhausted.';

commit;
