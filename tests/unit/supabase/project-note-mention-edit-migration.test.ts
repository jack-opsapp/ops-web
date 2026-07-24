import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260724020000_project_note_mention_edit_events.sql"
  ),
  "utf8"
);

describe("project note mention edit migration", () => {
  it("records every edit as immutable server-only proof beside the atomic note update", () => {
    expect(migration).toContain(
      "create table public.project_note_mention_events"
    );
    expect(migration).toContain(
      "create or replace function public.update_project_note_mentions"
    );
    expect(migration).toMatch(
      /update public\.project_notes[\s\S]*?mentioned_user_ids[\s\S]*?insert into public\.project_note_mention_events/i
    );
    expect(migration).toMatch(
      /create trigger project_note_mention_events_immutable[\s\S]*?before update or delete[\s\S]*?project note mention events are immutable/i
    );
    expect(migration).toMatch(
      /insert into public\.project_note_mention_events[\s\S]*?prior_content_snapshot[\s\S]*?prior_mentioned_user_ids[\s\S]*?content_snapshot[\s\S]*?mentioned_user_ids_snapshot[\s\S]*?recipient_user_ids/i
    );
    expect(migration).not.toMatch(
      /if\s+cardinality\(v_added_recipient_ids\)[\s\S]{0,80}insert into public\.project_note_mention_events/i
    );
  });

  it("serializes edits and computes the newly added recipient delta on the server", () => {
    expect(migration).toMatch(
      /from public\.project_notes[\s\S]*?where id = p_note_id[\s\S]*?for update/i
    );
    expect(migration).toMatch(
      /except[\s\S]*?unnest\(coalesce\(v_existing\.mentioned_user_ids/i
    );
    expect(migration).toMatch(
      /update public\.project_notes[\s\S]*?content = p_content[\s\S]*?mentioned_user_ids = v_effective_mentioned_user_ids/i
    );
  });

  it("canonicalizes retained valid UUIDs before computing the added-recipient delta", () => {
    expect(migration).toMatch(
      /except[\s\S]*?prior\.user_id::uuid::text[\s\S]*?unnest\(coalesce\(v_existing\.mentioned_user_ids[\s\S]*?where prior\.user_id ~\*/i
    );
  });

  it("requires an explicit complete mention list and validates every effective recipient", () => {
    expect(migration).toMatch(
      /p_mentioned_user_ids is null[\s\S]*?explicit mention list is required/i
    );
    expect(migration).toMatch(/requested mention user id is invalid/i);
    expect(migration).toMatch(
      /user_row\.company_id = v_company_id[\s\S]*?user_row\.is_active[\s\S]*?user_row\.deleted_at is null/i
    );
    expect(migration).toMatch(/candidate\.user_id <> v_actor_id::text/i);
  });

  it("normalizes duplicate UUID spellings by first-seen order while retaining the raw replay request", () => {
    expect(migration).toMatch(
      /min\(normalized\.ordinality\) as ordinality[\s\S]*?requested\.user_id::uuid::text as user_id[\s\S]*?group by normalized\.user_id/i
    );
    expect(migration).not.toContain(
      "requested mention user ids must be unique"
    );
    expect(migration).toMatch(
      /requested_mentioned_user_ids[\s\S]*?p_mentioned_user_ids/i
    );
  });

  it("authorizes the live human note author in the actor company", () => {
    expect(migration).toContain("private.get_current_user_id()");
    expect(migration).toContain("private.get_user_company_id()");
    expect(migration).toMatch(/v_existing\.author_id[\s\S]*?v_actor_id::text/i);
    expect(migration).toMatch(
      /v_existing\.company_id[\s\S]*?v_company_id::text/i
    );
    expect(migration).toMatch(/v_existing\.deleted_at is not null/i);
    expect(migration).toMatch(/v_existing\.event_kind is not null/i);
  });

  it("makes an exact event-id replay a read-only response and rejects mismatched reuse", () => {
    const replay = migration.slice(
      migration.indexOf("select event.*"),
      migration.indexOf("update public.project_notes")
    );
    expect(replay).toContain("event.id = p_event_id");
    expect(replay).toContain("v_replay.note_id = p_note_id");
    expect(replay).toContain("v_replay.actor_user_id = v_actor_id");
    expect(replay).toContain("v_replay.company_id = v_company_id");
    expect(replay).toContain(
      "v_replay.requested_content is not distinct from p_content"
    );
    expect(replay).toContain(
      "v_replay.requested_mentioned_user_ids is not distinct from p_mentioned_user_ids"
    );
    expect(replay).toContain(
      "mention edit event id was reused with a different request"
    );
    expect(replay).toContain("'replayed', true");
    expect(replay).not.toContain("update public.project_notes");
  });

  it("keeps event proof server-only and gives mention edits durable rail identity", () => {
    expect(migration).toContain(
      "alter table public.project_note_mention_events enable row level security"
    );
    expect(migration).toContain(
      "revoke all on table public.project_note_mention_events from public, anon, authenticated"
    );
    expect(migration).toContain(
      "grant select on table public.project_note_mention_events to service_role"
    );
    expect(migration).toMatch(
      /create policy project_note_mention_events_no_client_access[\s\S]*?as restrictive[\s\S]*?to anon, authenticated[\s\S]*?using \(false\)[\s\S]*?with check \(false\)/i
    );
    expect(migration).toMatch(
      /create unique index if not exists notifications_mention_edit_event_unique[\s\S]*?on public\.notifications\s*\(\s*user_id,\s*company_id,\s*type,\s*dedupe_key\s*\)[\s\S]*?where type = 'mention'[\s\S]*?dedupe_key like 'mention-edit:%'/i
    );
    expect(migration).toMatch(
      /revoke all on function public\.update_project_note_mentions\(uuid, text, text\[\], uuid\)[\s\S]*?from public, anon, authenticated, service_role/i
    );
    expect(migration).toMatch(
      /grant execute on function public\.update_project_note_mentions\(uuid, text, text\[\], uuid\)[\s\S]*?to anon, authenticated/i
    );
  });

  it("indexes every event-table foreign key used for parent-row integrity checks", () => {
    expect(migration).toMatch(
      /create index project_note_mention_events_note_created_idx[\s\S]*?on public\.project_note_mention_events \(note_id, created_at, id\)/i
    );
    expect(migration).toMatch(
      /create index project_note_mention_events_company_id_idx[\s\S]*?on public\.project_note_mention_events \(company_id\)/i
    );
    expect(migration).toMatch(
      /create index project_note_mention_events_actor_user_id_idx[\s\S]*?on public\.project_note_mention_events \(actor_user_id\)/i
    );
  });
});
