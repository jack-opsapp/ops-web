-- Dedicated local fixture. Exact relevant live columns/defaults/checks, captured 2026-09-10.
-- External foreign keys and unrelated trigger families are added by the transaction fixture, not faked here.
create schema private;
create type public.site_visit_status as enum ('scheduled','in_progress','completed','cancelled');
create role anon;create role authenticated;create role service_role;
CREATE OR REPLACE FUNCTION private.site_visit_type_fields_valid(p_fields jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select case
    when jsonb_typeof(p_fields) <> 'array' then false
    else jsonb_array_length(p_fields) between 1 and 100
    and pg_column_size(p_fields) <= 131072
    and exists (
      select 1
        from jsonb_array_elements(p_fields) as field
       where not (field ? 'isVisible')
          or field -> 'isVisible' = 'true'::jsonb
    )
    and (
      select count(*) = count(distinct field ->> 'id')
        from jsonb_array_elements(p_fields) as field
    )
    and not exists (
      select 1
        from jsonb_array_elements(p_fields) as field
       where jsonb_typeof(field) <> 'object'
          or jsonb_typeof(field -> 'id') <> 'string'
          or char_length(field ->> 'id') not between 1 and 256
          or jsonb_typeof(field -> 'label') <> 'string'
          or char_length(field ->> 'label') not between 1 and 500
          or btrim(field ->> 'label') = ''
          or jsonb_typeof(field -> 'kind') <> 'string'
          or field ->> 'kind' not in (
            'checkbox',
            'yes_no_na',
            'short_text',
            'long_text',
            'measurement',
            'photo',
            'photo_markup',
            'deck_design'
          )
          or jsonb_typeof(field -> 'required') <> 'boolean'
          or jsonb_typeof(field -> 'sortOrder') <> 'number'
          or (field ? 'helpText' and field -> 'helpText' <> 'null'::jsonb
              and jsonb_typeof(field -> 'helpText') <> 'string')
          or (field ? 'helpText' and field -> 'helpText' <> 'null'::jsonb
              and char_length(field ->> 'helpText') > 2000)
          or (field ? 'isVisible'
              and jsonb_typeof(field -> 'isVisible') <> 'boolean')
    )
  end;
$function$
;
create table public.site_visits (
  id uuid not null default gen_random_uuid(),
  company_id text not null,
  opportunity_id uuid,
  project_id text,
  client_id text,
  scheduled_at timestamp with time zone not null,
  duration_minutes integer not null default 60,
  assignee_ids text[] default '{}'::text[],
  status public.site_visit_status not null default 'scheduled'::site_visit_status,
  completed_at timestamp with time zone,
  notes text,
  internal_notes text,
  measurements text,
  photos text[] default '{}'::text[],
  activity_id uuid,
  calendar_event_id text,
  created_by text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  deleted_at timestamp with time zone,
  client_ref uuid,
  project_ref uuid,
  google_calendar_event_id text,
  google_calendar_id text,
  google_calendar_synced_at timestamp with time zone,
  booked_at timestamp with time zone,
  reminder_lead_minutes integer,
  appointment_handoff_id uuid,
  appointment_kind text,
  appointment_title text,
  appointment_location text,
  appointment_attendees jsonb
);
alter table public.site_visits add constraint site_visits_appointment_attendees_check CHECK (((appointment_attendees IS NULL) OR (jsonb_typeof(appointment_attendees) = 'array'::text)));
alter table public.site_visits add constraint site_visits_appointment_kind_check CHECK (((appointment_kind IS NULL) OR (appointment_kind = ANY (ARRAY['site_visit'::text, 'meeting'::text, 'call'::text, 'work'::text]))));
alter table public.site_visits add constraint site_visits_pkey PRIMARY KEY (id);
alter table public.site_visits add constraint site_visits_reminder_lead_minutes_check CHECK (((reminder_lead_minutes IS NULL) OR ((reminder_lead_minutes >= 0) AND (reminder_lead_minutes <= 1440))));
CREATE INDEX idx_site_visits_company ON public.site_visits USING btree (company_id);
CREATE INDEX idx_site_visits_opportunity ON public.site_visits USING btree (opportunity_id);
CREATE INDEX idx_site_visits_client_ref ON public.site_visits USING btree (client_ref);
CREATE INDEX idx_site_visits_project_ref ON public.site_visits USING btree (project_ref);
CREATE UNIQUE INDEX site_visits_google_event_unique ON public.site_visits USING btree (google_calendar_id, google_calendar_event_id) WHERE (google_calendar_event_id IS NOT NULL);
CREATE INDEX site_visits_booked_window_idx ON public.site_visits USING btree (company_id, scheduled_at) WHERE ((booked_at IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX site_visits_activity_id_idx ON public.site_visits USING btree (activity_id);
CREATE INDEX idx_site_visits_agent_artifact_opportunity_v1 ON public.site_visits USING btree (lower(company_id), opportunity_id, id) WHERE ((deleted_at IS NULL) AND (opportunity_id IS NOT NULL));
CREATE INDEX idx_site_visits_agent_artifact_project_v1 ON public.site_visits USING btree (lower(company_id), COALESCE((project_ref)::text, lower(project_id)), id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_site_visits_agent_booked_order_v1 ON public.site_visits USING btree (company_id, date_bin('00:00:00.001'::interval, booked_at, '2000-01-01 00:00:00+00'::timestamp with time zone), id) WHERE ((deleted_at IS NULL) AND (booked_at IS NOT NULL));
CREATE INDEX idx_site_visits_agent_history_order_v1 ON public.site_visits USING btree (company_id, date_bin('00:00:00.001'::interval, created_at, '2000-01-01 00:00:00+00'::timestamp with time zone) DESC, id DESC) WHERE ((deleted_at IS NULL) AND (created_at IS NOT NULL));
CREATE INDEX idx_site_visits_agent_availability_v1 ON public.site_visits USING btree (company_id, scheduled_at, id) INCLUDE (duration_minutes, assignee_ids, status) WHERE ((deleted_at IS NULL) AND (booked_at IS NOT NULL) AND (status = ANY (ARRAY['scheduled'::site_visit_status, 'in_progress'::site_visit_status])));
CREATE INDEX idx_site_visits_agent_hiring_history_v1 ON public.site_visits USING btree (company_id, scheduled_at, id) INCLUDE (project_ref, project_id, duration_minutes, assignee_ids, status, booked_at) WHERE ((deleted_at IS NULL) AND (booked_at IS NOT NULL) AND (status <> 'cancelled'::site_visit_status));
CREATE UNIQUE INDEX site_visits_phase_c_handoff_key ON public.site_visits USING btree (appointment_handoff_id) WHERE (appointment_handoff_id IS NOT NULL);
create table public.site_visit_types (
  id text not null,
  company_id text not null,
  slug text not null,
  name text not null,
  description_text text,
  is_system_template boolean not null default false,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  fields jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone
);
alter table public.site_visit_types add constraint site_visit_types_company_id_length CHECK (((char_length(company_id) >= 1) AND (char_length(company_id) <= 256)));
alter table public.site_visit_types add constraint site_visit_types_description_length CHECK (((description_text IS NULL) OR (char_length(description_text) <= 500)));
alter table public.site_visit_types add constraint site_visit_types_fields_valid CHECK (private.site_visit_type_fields_valid(fields));
alter table public.site_visit_types add constraint site_visit_types_id_length CHECK (((char_length(id) >= 1) AND (char_length(id) <= 256)));
alter table public.site_visit_types add constraint site_visit_types_name_length CHECK ((((char_length(name) >= 1) AND (char_length(name) <= 120)) AND (btrim(name) <> ''::text)));
alter table public.site_visit_types add constraint site_visit_types_pkey PRIMARY KEY (id);
alter table public.site_visit_types add constraint site_visit_types_slug_length CHECK (((char_length(slug) >= 1) AND (char_length(slug) <= 128)));
CREATE UNIQUE INDEX site_visit_types_active_company_slug_uidx ON public.site_visit_types USING btree (company_id, slug) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX site_visit_types_active_company_default_uidx ON public.site_visit_types USING btree (company_id) WHERE ((deleted_at IS NULL) AND is_default);
CREATE INDEX site_visit_types_active_company_order_idx ON public.site_visit_types USING btree (company_id, sort_order, name) WHERE (deleted_at IS NULL);
create table public.site_visit_checklist_answers (
  id uuid not null default gen_random_uuid(),
  site_visit_id uuid not null,
  company_id text not null,
  opportunity_id uuid,
  site_visit_type_id text,
  field_id text not null,
  label text not null,
  kind text not null,
  required boolean not null default false,
  help_text text,
  sort_order integer not null default 0,
  answer_value jsonb not null default '{}'::jsonb,
  created_by text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone
);
alter table public.site_visit_checklist_answers add constraint site_visit_checklist_answers_created_by_length CHECK (((char_length(created_by) >= 1) AND (char_length(created_by) <= 256)));
alter table public.site_visit_checklist_answers add constraint site_visit_checklist_answers_field_id_length CHECK (((char_length(field_id) >= 1) AND (char_length(field_id) <= 256)));
alter table public.site_visit_checklist_answers add constraint site_visit_checklist_answers_help_length CHECK (((help_text IS NULL) OR (char_length(help_text) <= 2000)));
alter table public.site_visit_checklist_answers add constraint site_visit_checklist_answers_kind_check CHECK ((kind = ANY (ARRAY['checkbox'::text, 'yes_no_na'::text, 'short_text'::text, 'long_text'::text, 'measurement'::text, 'photo'::text, 'photo_markup'::text, 'deck_design'::text])));
alter table public.site_visit_checklist_answers add constraint site_visit_checklist_answers_label_length CHECK (((char_length(label) >= 1) AND (char_length(label) <= 500)));
alter table public.site_visit_checklist_answers add constraint site_visit_checklist_answers_pkey PRIMARY KEY (id);
alter table public.site_visit_checklist_answers add constraint site_visit_checklist_answers_type_id_length CHECK (((site_visit_type_id IS NULL) OR (char_length(site_visit_type_id) <= 256)));
alter table public.site_visit_checklist_answers add constraint site_visit_checklist_answers_value_shape CHECK (((jsonb_typeof(answer_value) = 'object'::text) AND (pg_column_size(answer_value) <= 1048576)));
CREATE INDEX site_visit_checklist_answers_site_visit_idx ON public.site_visit_checklist_answers USING btree (site_visit_id);
CREATE INDEX site_visit_checklist_answers_active_company_visit_idx ON public.site_visit_checklist_answers USING btree (company_id, site_visit_id) WHERE (deleted_at IS NULL);
CREATE INDEX site_visit_checklist_answers_active_opportunity_idx ON public.site_visit_checklist_answers USING btree (opportunity_id) WHERE ((deleted_at IS NULL) AND (opportunity_id IS NOT NULL));
CREATE UNIQUE INDEX site_visit_checklist_answers_active_field_uidx ON public.site_visit_checklist_answers USING btree (site_visit_id, field_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_site_visit_checklist_answers_agent_context_v1 ON public.site_visit_checklist_answers USING btree (company_id, site_visit_id, sort_order, id) WHERE (deleted_at IS NULL);

