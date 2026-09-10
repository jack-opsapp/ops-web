-- Release step 5 (after the deploy is verified and the OPS Journal routine
-- exists): switch the weekly journal pipeline on in preview mode. Slots open
-- 72 hours before each Monday 06:00 Vancouver; drafts become previews that
-- wait for PUBLISH NOW in the Blog hub. Nothing publishes on its own.
update public.journal_editorial_settings
set mode = 'prepare', updated_at = now()
where id;

-- Verify.
select mode, updated_at from public.journal_editorial_settings;

-- Later, only after Jackson approves automatic Monday publication:
-- update public.journal_editorial_settings set mode = 'publish', updated_at = now() where id;
-- Only slots claimed after that switch publish on their own; a draft written
-- under 'prepare' still waits for PUBLISH NOW.
