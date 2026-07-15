-- W3 security posture sweep — §7 follow-up: revoke ANONYMOUS write/update/delete on the
-- public `images` and `social-media` storage buckets.
--
-- FINDING (disposition doc §7 "Additional bucket finding", verified live 2026-07-03 and
-- re-verified 2026-07-05 on ijeekuhbatykdomumfjx): both buckets carried storage.objects
-- policies that let the PUBLIC anon key INSERT / UPDATE / DELETE objects with only a
-- bucket_id check and no auth — i.e. any outsider holding the (public) anon key could
-- overwrite or delete objects. For `social-media`, whose graphics auto-publish to
-- Instagram, that is a brand-integrity attack: swap a pending story graphic and it posts.
--
--   images        · "Service upload images"   (INSERT {public}  with check bucket_id='images')
--                 · "Service update images"   (UPDATE {public}  bucket_id='images')
--                 · "Service delete images"   (DELETE {public}  bucket_id='images')
--   social-media  · "Allow anon uploads to social-media"   (INSERT {anon}  bucket_id='social-media')
--                 · "Allow anon updates to social-media"   (UPDATE {anon}  bucket_id='social-media')
--                 · "Allow anon deletes from social-media" (DELETE {anon}  bucket_id='social-media')
--
-- WHY A CLEAN DROP IS SAFE (every real writer is service_role, which bypasses RLS):
--   * ops-web writes both buckets ONLY server-side via getServiceRoleClient()
--     (api/uploads/presign, api/uploads/delete, api/admin/blog/upload,
--     api/integrations/email/extract-images). The default storage backend is S3
--     anyway; the Supabase path is a service_role rollback branch.
--   * The social-media generator scripts/social-generators/supabase_upload.py
--     authenticates with the SERVICE ROLE key — `git log -S SUPABASE_ANON_KEY` proves
--     the anon key was NEVER in that file; it has been service_role since its first
--     commit (2026-04-15), predating every object in the bucket (2026-04-20 onward).
--     The `custom/test-anon-write.jpg` / `stories/probe-*.png` objects are fingerprints
--     of a pre-commit anon prototype, not the production write path.
--   * The Instagram publisher edge function (social-publish-instagram) only READS
--     public object URLs; it never writes to storage.
--   * service_role and postgres have rolbypassrls = true (verified) → every legitimate
--     write keeps working with zero policy present.
--
-- PUBLIC SERVING IS UNAFFECTED: both buckets remain public; getPublicUrl() serves object
-- URLs without consulting storage RLS. Neither bucket has (or needs) a SELECT policy
-- after this change — `images`' broad listing policy was already dropped by
-- 20260703170100_sec_w3_storage_public_bucket_listing; `social-media` never had one.
--
-- NET POSTURE after this migration: public read, service-role-only write on both buckets.
-- Sentinel-proven against prod in a rolled-back transaction: baseline anon INSERT was
-- ALLOWED on both buckets; after the drop, anon INSERT/UPDATE/DELETE is BLOCKED
-- (RLS, SQLSTATE 42501) on both, while service_role INSERT still succeeds.
--
-- Rollback: supabase/migrations/rollbacks/20260705170000_sec_w3_storage_anon_write_revoke.rollback.sql

begin;

drop policy if exists "Service upload images"                on storage.objects;
drop policy if exists "Service update images"                on storage.objects;
drop policy if exists "Service delete images"                on storage.objects;
drop policy if exists "Allow anon uploads to social-media"   on storage.objects;
drop policy if exists "Allow anon updates to social-media"   on storage.objects;
drop policy if exists "Allow anon deletes from social-media" on storage.objects;

-- Sentinel: (1) none of the six anon write policies may remain, and (2) behaviorally an
-- anon-bridge caller must be unable to INSERT into either bucket. Any residual policy or
-- any permitted anon write raises and aborts the migration (rolling the drop back). The
-- behavioral probe mirrors the pre-apply dry-run; a denied write leaves no row, and a
-- leaked write is caught before commit, so the sentinel never persists test objects.
do $sentinel$
declare
  v_remaining      int;
  v_leaked_images  boolean := false;
  v_leaked_social  boolean := false;
begin
  select count(*) into v_remaining
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in (
      'Service upload images', 'Service update images', 'Service delete images',
      'Allow anon uploads to social-media', 'Allow anon updates to social-media',
      'Allow anon deletes from social-media'
    );
  if v_remaining <> 0 then
    raise exception 'sec_w3_anon_write sentinel: % target policy(ies) still present', v_remaining;
  end if;

  -- Simulate the Firebase-bridge anon caller (role anon + a claims payload) and prove
  -- writes are denied. Treat ANY insert error as "denied" (the minimal (bucket_id, name)
  -- insert is otherwise valid — it succeeds for anon BEFORE the drop — so post-drop the
  -- only thing that can reject it is RLS).
  begin
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon","sub":"sec_w3_sentinel"}', true);
    insert into storage.objects (bucket_id, name) values ('images', '__sec_w3_sentinel__/probe.png');
    v_leaked_images := true;  -- reached only if RLS permitted the write
  exception when others then
    v_leaked_images := false; -- denied (expected)
  end;
  reset role;

  begin
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon","sub":"sec_w3_sentinel"}', true);
    insert into storage.objects (bucket_id, name) values ('social-media', '__sec_w3_sentinel__/probe.png');
    v_leaked_social := true;
  exception when others then
    v_leaked_social := false;
  end;
  reset role;

  if v_leaked_images then
    raise exception 'sec_w3_anon_write sentinel: anon INSERT to images was NOT blocked';
  end if;
  if v_leaked_social then
    raise exception 'sec_w3_anon_write sentinel: anon INSERT to social-media was NOT blocked';
  end if;
end
$sentinel$;

commit;
