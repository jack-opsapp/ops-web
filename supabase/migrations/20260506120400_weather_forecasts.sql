-- Cache table for Open-Meteo forecasts. Re-fetched only when the most recent
-- entry per (project, date) is older than 12 hours. Reads are scoped by
-- private.get_user_company_id() (canonical OPS RLS pattern). Writes are
-- service_role only — the hook calls a Next.js route handler that uses the
-- service key.

CREATE TABLE IF NOT EXISTS weather_forecasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  forecast_date   DATE NOT NULL,
  temp_high_c     NUMERIC(4,1),
  temp_low_c      NUMERIC(4,1),
  temp_current_c  NUMERIC(4,1),
  precipitation_mm NUMERIC(5,2),
  precipitation_probability SMALLINT CHECK (precipitation_probability BETWEEN 0 AND 100),
  wind_speed_kmh  NUMERIC(5,1),
  conditions      TEXT,
  retrieved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source          TEXT NOT NULL DEFAULT 'open-meteo',
  UNIQUE (project_id, forecast_date)
);

CREATE INDEX IF NOT EXISTS idx_weather_project_date ON weather_forecasts(project_id, forecast_date);
CREATE INDEX IF NOT EXISTS idx_weather_retrieved_at ON weather_forecasts(retrieved_at);

COMMENT ON TABLE weather_forecasts IS 'Cached Open-Meteo daily/current forecasts per project. Refreshed via the weather route handler when entries age past 12h. Attribution: Weather data by Open-Meteo.com.';
COMMENT ON COLUMN weather_forecasts.source IS 'Provider tag. Always open-meteo today; reserved for future providers.';

ALTER TABLE weather_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation_select"
  ON weather_forecasts FOR SELECT
  USING (company_id = (SELECT private.get_user_company_id()));

-- Service-role writes only (the route handler uses SUPABASE_SERVICE_ROLE_KEY).
-- We add explicit policies; the service role bypasses RLS, but adding the
-- policies makes intent explicit for any future role/key.
CREATE POLICY "service_role_insert"
  ON weather_forecasts FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "service_role_update"
  ON weather_forecasts FOR UPDATE
  USING (auth.role() = 'service_role');

CREATE POLICY "service_role_delete"
  ON weather_forecasts FOR DELETE
  USING (auth.role() = 'service_role');
