-- Lead Lifecycle P5 — blank provider-id rewrite backstop (CW1).
--
-- Additive, non-breaking, iOS-safe. BEFORE INSERT/UPDATE triggers on the two
-- iOS-synced thread tables that REWRITE an empty / whitespace-only provider id
-- to a deterministic synthetic value rather than rejecting the write.
--
-- iOS-sync constraint: `email_threads` and `opportunity_email_threads` are
-- synced to shipped iOS clients. A hard CHECK / NOT NULL change could reject a
-- write emitted by an older shipped build between App Store releases. These
-- triggers NEVER raise and NEVER reject — they only correct an otherwise-blank
-- id in place. The columns are already TEXT NOT NULL, so the only corruption
-- class is the empty string (and, defensively, all-whitespace).
--
-- Synthetic-id contract: the rewrite uses the `legacy:` prefix
-- (`'legacy:' || NEW.id::text`), matching the DW1 blank-thread remediation
-- convention (`scripts/lead-lifecycle-p1-blank-thread-remediation.ts`) AND the
-- P3 lead-lifecycle cron's fragmented-skip predicate
-- (`LEGACY_THREAD_PREFIX = 'legacy%'` in
-- `src/lib/api/services/lead-lifecycle-cron-service.ts`). A row corrected here
-- is therefore recognized as fragmented/quarantined by the cron's
-- `LIKE 'legacy%'` family and is never acted on destructively.
--
-- Non-recursive: a BEFORE trigger that mutates only NEW and returns NEW does
-- not re-fire. Idempotent: a value that is already non-blank (including an
-- already-rewritten `legacy:<uuid>`) is left untouched.

create or replace function public.email_threads_rewrite_blank_provider()
returns trigger
language plpgsql
as $$
begin
  -- Defensive: NOT NULL is already enforced, so this guards the empty-string
  -- and all-whitespace cases. coalesce keeps the predicate null-safe.
  if btrim(coalesce(new.provider_thread_id, '')) = '' then
    new.provider_thread_id := 'legacy:' || new.id::text;
  end if;
  return new;
end;
$$;

create or replace function public.opportunity_email_threads_rewrite_blank_thread()
returns trigger
language plpgsql
as $$
begin
  if btrim(coalesce(new.thread_id, '')) = '' then
    new.thread_id := 'legacy:' || new.id::text;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.email_threads'::regclass
       and tgname = 'email_threads_blank_provider_guard'
  ) then
    create trigger email_threads_blank_provider_guard
      before insert or update of provider_thread_id
      on public.email_threads
      for each row
      execute function public.email_threads_rewrite_blank_provider();
  end if;

  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.opportunity_email_threads'::regclass
       and tgname = 'opportunity_email_threads_blank_thread_guard'
  ) then
    create trigger opportunity_email_threads_blank_thread_guard
      before insert or update of thread_id
      on public.opportunity_email_threads
      for each row
      execute function public.opportunity_email_threads_rewrite_blank_thread();
  end if;
end;
$$;
