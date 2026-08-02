-- Cover both nullable foreign keys traversed by site-visit completion and
-- project-photo handoff. These legacy relationships predate durable sync.

begin;

create index if not exists project_photos_site_visit_id_idx
  on public.project_photos (site_visit_id);

create index if not exists site_visits_activity_id_idx
  on public.site_visits (activity_id);

commit;
