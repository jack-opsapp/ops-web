-- ROLLBACK for 20260705170000_sec_w3_storage_anon_write_revoke.
--
-- Recreates the six anon/public write policies on storage.objects for the `images` and
-- `social-media` buckets EXACTLY as they existed before the revoke. Running this REOPENS
-- the anonymous write / overwrite / delete exposure documented in W3 §7 — only run it to
-- back the fix out. Not in the apply path (rollbacks/ subdir). Run as postgres.

begin;

-- images (role: public — bucket_id-only checks, no auth)
create policy "Service upload images" on storage.objects
  for insert to public
  with check (bucket_id = 'images'::text);

create policy "Service update images" on storage.objects
  for update to public
  using (bucket_id = 'images'::text)
  with check (bucket_id = 'images'::text);

create policy "Service delete images" on storage.objects
  for delete to public
  using (bucket_id = 'images'::text);

-- social-media (role: anon — bucket_id-only checks, no auth)
create policy "Allow anon uploads to social-media" on storage.objects
  for insert to anon
  with check (bucket_id = 'social-media'::text);

create policy "Allow anon updates to social-media" on storage.objects
  for update to anon
  using (bucket_id = 'social-media'::text);

create policy "Allow anon deletes from social-media" on storage.objects
  for delete to anon
  using (bucket_id = 'social-media'::text);

commit;
