-- LiDAR dimensioned-photo rendered deliverable continuity.
-- The source HEIC stays in project_photos.url; the burned-in 2048-long-edge PNG
-- is a derived field deliverable stored separately for gallery/portal display.

alter type public.photo_source add value if not exists 'measurement';

alter table public.project_photos
  add column if not exists rendered_url text;

comment on column public.project_photos.rendered_url is
  'Derived 2048-long-edge PNG deliverable for dimensioned captures. project_photos.url remains the source HEIC. NULL for legacy/non-measurement photos.';

alter table public.project_photo_annotations
  add column if not exists rendered_photo_url text;

comment on column public.project_photo_annotations.rendered_photo_url is
  'Derived 2048-long-edge PNG deliverable URL for dimensioned photo annotations. photo_url remains the source HEIC.';
