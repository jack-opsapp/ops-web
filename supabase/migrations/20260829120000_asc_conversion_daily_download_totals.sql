-- asc_conversion_daily: the downloads CTE only counted rows whose
-- download_type was NULL or a literal total ('total downloads' / 'total').
-- Apple's "App Store Downloads Standard" report emits breakdown rows
-- (First-time download / Redownload) and no total row, so the view would
-- report zero downloads forever once ingestion starts. Sum the breakdown
-- rows; exclude any literal total row so a hypothetical total+breakdown file
-- cannot double-count. No behavior change while asc_downloads is empty.
--
-- PM PRE-APPLY CHECK: confirm the live view already carries
-- security_invoker=true before applying (the bible records an M6 hardening
-- pass on this view):
--   SELECT c.reloptions FROM pg_class c
--     JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relname = 'asc_conversion_daily';
-- If it does NOT, drop the `with (security_invoker = true)` clause below so
-- this matches production exactly. CREATE OR REPLACE VIEW preserves existing
-- grants either way.
begin;

create or replace view public.asc_conversion_daily
with (security_invoker = true) as
 WITH imp AS (
         SELECT asc_discovery_engagement.reporting_date,
            asc_discovery_engagement.territory,
            asc_discovery_engagement.channel,
            sum(asc_discovery_engagement.unique_counts) AS unique_impressions
           FROM asc_discovery_engagement
          WHERE lower(asc_discovery_engagement.engagement_type) ~~ '%impression%'::text
          GROUP BY asc_discovery_engagement.reporting_date, asc_discovery_engagement.territory, asc_discovery_engagement.channel
        ), dl AS (
         SELECT asc_downloads.reporting_date,
            asc_downloads.territory,
            asc_downloads.channel,
            sum(asc_downloads.counts) AS total_downloads
           FROM asc_downloads
          WHERE asc_downloads.download_type IS NULL
             OR lower(asc_downloads.download_type) <> ALL (ARRAY['total downloads'::text, 'total'::text])
          GROUP BY asc_downloads.reporting_date, asc_downloads.territory, asc_downloads.channel
        )
 SELECT COALESCE(imp.reporting_date, dl.reporting_date) AS reporting_date,
    COALESCE(imp.territory, dl.territory) AS territory,
    COALESCE(imp.channel, dl.channel) AS channel,
    COALESCE(imp.unique_impressions, 0::numeric) AS unique_impressions,
    COALESCE(dl.total_downloads, 0::numeric) AS total_downloads,
        CASE
            WHEN COALESCE(imp.unique_impressions, 0::numeric) > 0::numeric
              THEN COALESCE(dl.total_downloads, 0::numeric) / imp.unique_impressions
            ELSE NULL::numeric
        END AS conversion_rate,
    COALESCE(imp.reporting_date, dl.reporting_date) > (CURRENT_DATE - 2) AS provisional
   FROM imp
     FULL JOIN dl ON imp.reporting_date = dl.reporting_date
       AND imp.territory = dl.territory AND imp.channel = dl.channel;

commit;
