-- Live column types, nullability and defaults from 2026-09-05. Cross-table FKs and write triggers are outside this read-only fixture.
create table private.agent_provider_delivery_sources (
id uuid not null default gen_random_uuid(),
company_id uuid not null,
connection_id uuid not null,
provider text not null,
provider_message_id text not null,
provider_thread_id text not null,
direction text not null,
delivered_at timestamp with time zone not null,
subject text not null,
normalized_subject text,
normalized_plain_text text not null,
normalization_revision text not null,
normalization_status text not null,
sender_identity text not null,
recipient_identities text[] not null,
cc_recipient_identities text[] not null,
content_media_type text not null,
content_value text not null,
content_charset text,
content_source_kind text not null,
content_selection_revision text not null,
provider_part_id text,
provider_body_attachment_id text,
attachment_enumeration_complete boolean not null,
attachment_descriptors jsonb not null,
attachment_evidence_ids text[] not null,
source_sha256 text not null,
captured_at timestamp with time zone not null default clock_timestamp()
);
alter table private.agent_provider_delivery_sources enable row level security;
create table public.job_conversation_anchors (
id uuid not null default gen_random_uuid(),
company_id uuid not null,
conversation_id uuid not null,
anchor_kind text not null,
opportunity_id uuid,
project_id uuid,
source_id uuid generated always as (COALESCE(opportunity_id, project_id)) stored,
created_at timestamp with time zone not null default clock_timestamp()
);
alter table public.job_conversation_anchors enable row level security;
create table public.job_conversation_redaction_events (
id uuid not null default gen_random_uuid(),
company_id uuid not null,
conversation_id uuid not null,
target_turn_id uuid not null,
redaction_kind text not null,
reason text not null,
replacement_plain_text text,
actor_user_id uuid,
authority_revision text not null,
source_state_revision bigint not null,
created_at timestamp with time zone not null default clock_timestamp()
);
alter table public.job_conversation_redaction_events enable row level security;
create table public.job_conversation_turns (
id uuid not null default gen_random_uuid(),
company_id uuid not null,
conversation_id uuid not null,
turn_sequence bigint not null,
source_state_revision bigint not null,
side text,
participant_id text not null,
participant_resolution_status text not null,
participant_resolution_revision text not null,
direction text not null,
channel text not null,
delivered_at timestamp with time zone not null,
source_connection_id uuid not null,
provider_message_id text not null,
provider_delivery_source_id uuid not null,
provider_delivery_source_sha256 text not null,
source_activity_id uuid,
source_correspondence_event_id uuid,
subject text,
recipient_identities text[] not null default '{}'::text[],
cc_recipient_identities text[] not null default '{}'::text[],
normalized_plain_text text not null,
original_content_hash text not null,
attachment_evidence_ids text[] not null default '{}'::text[],
ingested_at timestamp with time zone not null default clock_timestamp()
);
alter table public.job_conversation_turns enable row level security;
create table public.job_conversations (
id uuid not null default gen_random_uuid(),
company_id uuid not null,
current_memory_version_id uuid,
last_turn_sequence bigint not null default 0,
source_state_revision bigint not null default 0,
created_at timestamp with time zone not null default clock_timestamp(),
updated_at timestamp with time zone not null default clock_timestamp()
);
alter table public.job_conversations enable row level security;
create table public.job_memory_version_evidence (
id uuid not null default gen_random_uuid(),
company_id uuid not null,
conversation_id uuid not null,
memory_version_id uuid not null,
evidence_id text not null,
relationship text not null,
source_domain text not null,
source_type text not null,
source_entity_id text not null,
source_revision text not null,
source_content_hash text,
created_at timestamp with time zone not null default clock_timestamp()
);
alter table public.job_memory_version_evidence enable row level security;
create table public.job_memory_versions (
id uuid not null default gen_random_uuid(),
company_id uuid not null,
conversation_id uuid not null,
version_number integer not null,
predecessor_version_id uuid,
turn_high_watermark_id uuid not null,
turn_high_watermark_sequence bigint not null,
source_state_revision bigint not null,
generation_input_hash text not null,
memory_document jsonb not null,
memory_document_hash text not null,
generator_revision text not null,
created_at timestamp with time zone not null default clock_timestamp()
);
alter table public.job_memory_versions enable row level security;
