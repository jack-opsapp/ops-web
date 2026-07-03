-- W3 security posture sweep — close `public_bucket_allows_listing` (advisor lint
-- 0025) on the six public buckets flagged by get_advisors.
--
-- Each flagged bucket has a broad SELECT / USING (bucket_id = '<bucket>') policy to
-- {public} on storage.objects. For a PUBLIC bucket that policy is unnecessary for
-- serving — objects are fetched by their public URL, which bypasses storage RLS —
-- but it DOES enable storage list()/enumeration of every object across all tenants
-- (folder paths embed company_id/project_id). Per Supabase's own lint-0025 guidance
-- and the Storage access-control docs, dropping the SELECT policy leaves public
-- object URLs working and only removes enumeration.
--
-- Verified safe for OPS: a full repo grep found NO storage `.list()` call on any
-- bucket. The only storage reads are getPublicUrl('images', ...) (unaffected —
-- public URL) and createSignedUrl on the PRIVATE buckets 'bug-reports' /
-- 'spec-intake' (untouched here; those keep their scoped policies). Project photos
-- render via stored public URLs, not via list/download, so Canpro/Maverick photo
-- surfaces are unaffected.
--
-- The write/serve policies for these buckets are intentionally left as-is by this
-- migration; the anon write exposure on the 'images'/'social-media' buckets is
-- tracked separately in the W3 disposition (needs upload-flow verification first).

begin;

drop policy if exists "Anyone can view client images"      on storage.objects; -- client-images
drop policy if exists "Public read images"                 on storage.objects; -- images
drop policy if exists "Anyone can view logos"              on storage.objects; -- logos
drop policy if exists "Anyone can view product thumbnails" on storage.objects; -- product-thumbnails
drop policy if exists "Anyone can view profiles"           on storage.objects; -- profiles
drop policy if exists "project photos select public"       on storage.objects; -- project-photos

-- Sentinel: none of the six broad listing policies may remain on storage.objects.
do $do$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in (
      'Anyone can view client images',
      'Public read images',
      'Anyone can view logos',
      'Anyone can view product thumbnails',
      'Anyone can view profiles',
      'project photos select public'
    );
  if v_bad <> 0 then
    raise exception 'sec_w3_bucket_listing_sentinel: % broad listing policy(ies) still present', v_bad;
  end if;
end
$do$;

commit;
