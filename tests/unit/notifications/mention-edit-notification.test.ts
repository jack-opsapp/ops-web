import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { resolveNotificationEvent } from "@/lib/notifications/notification-event-resolver";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  name: "Alex Author",
};
const noteId = "33333333-3333-4333-8333-333333333333";
const projectId = "44444444-4444-4444-8444-444444444444";
const mentionEventId = "55555555-5555-4555-8555-555555555555";
const bobId = "66666666-6666-4666-8666-666666666666";
const aliceId = "77777777-7777-4777-8777-777777777777";

function singleResult(data: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is"]) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = async () => ({ data, error: null });
  return builder;
}

function listResult(data: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "in", "eq"]) {
    builder[method] = () => builder;
  }
  const result = { data, error: null };
  builder.is = async () => result;
  builder.then = (
    resolve: (value: typeof result) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

describe("mention-edit notification proof", () => {
  it("derives immutable copy and only currently mentioned, active same-company recipients", async () => {
    const queriedTables: string[] = [];
    const db = {
      from: (table: string) => {
        queriedTables.push(table);
        if (table === "project_note_mention_events") {
          return singleResult({
            id: mentionEventId,
            note_id: noteId,
            project_id: projectId,
            company_id: actor.companyId,
            actor_user_id: actor.userId,
            recipient_user_ids: [aliceId, bobId],
            content_snapshot: `@[Alice Able](${aliceId}) and @[All Team](all-team) check the seam.`,
            actor_name_snapshot: "Alex Author",
            project_title_snapshot: "Deck rebuild",
            created_at: new Date().toISOString(),
          });
        }
        if (table === "project_notes") {
          return singleResult({
            id: noteId,
            project_id: projectId,
            company_id: actor.companyId,
            author_id: actor.userId,
            mentioned_user_ids: [bobId],
            deleted_at: null,
            event_kind: null,
          });
        }
        if (table === "users") {
          return listResult([{ id: bobId }]);
        }
        if (table === "projects") {
          return singleResult({
            id: projectId,
            company_id: actor.companyId,
            title: "Deck rebuild",
            status: "active",
            team_member_ids: [],
            opportunity_ref: null,
            updated_at: new Date().toISOString(),
            deleted_at: null,
          });
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;

    const result = await resolveNotificationEvent({
      db,
      actor,
      request: { eventType: "mention_edit", mentionEventId },
    });

    expect(result).toEqual({
      ok: true,
      event: expect.objectContaining({
        eventType: "mention_edit",
        recipientUserIds: [bobId],
        title: "Alex Author mentioned you",
        projectId,
        noteId,
        dedupeKey: `mention-edit:${mentionEventId}`,
        body: "“@Alice Able and @All Team check the seam.” on Deck rebuild",
        pushData: {
          type: "projectNoteMention",
          projectId,
          noteId,
          screen: "projectNotes",
        },
      }),
    });
    expect(queriedTables).toContain("users");
  });

  it("treats an edit with no newly added recipients as a successful no-op", async () => {
    const queriedTables: string[] = [];
    const db = {
      from: (table: string) => {
        queriedTables.push(table);
        if (table === "project_note_mention_events") {
          return singleResult({
            id: mentionEventId,
            note_id: noteId,
            project_id: projectId,
            company_id: actor.companyId,
            actor_user_id: actor.userId,
            recipient_user_ids: [],
            content_snapshot: "No mentions remain.",
            actor_name_snapshot: "Alex Author",
            project_title_snapshot: "Deck rebuild",
            created_at: new Date().toISOString(),
          });
        }
        if (table === "project_notes") {
          return singleResult({
            id: noteId,
            project_id: projectId,
            company_id: actor.companyId,
            author_id: actor.userId,
            mentioned_user_ids: [],
            deleted_at: null,
            event_kind: null,
          });
        }
        if (table === "projects") {
          return singleResult({
            id: projectId,
            company_id: actor.companyId,
            title: "Renamed after edit",
            status: "active",
            team_member_ids: [],
            opportunity_ref: null,
            updated_at: new Date().toISOString(),
            deleted_at: null,
          });
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;

    const result = await resolveNotificationEvent({
      db,
      actor,
      request: { eventType: "mention_edit", mentionEventId },
    });

    expect(result).toEqual({
      ok: true,
      event: expect.objectContaining({
        recipientUserIds: [],
        dedupeKey: `mention-edit:${mentionEventId}`,
        body: "“No mentions remain.” on Deck rebuild",
      }),
    });
    expect(queriedTables).not.toContain("users");
  });

  it("rejects proof before the provider idempotency window can expire", async () => {
    const queriedTables: string[] = [];
    const db = {
      from: (table: string) => {
        queriedTables.push(table);
        if (table === "project_note_mention_events") {
          return singleResult({
            id: mentionEventId,
            note_id: noteId,
            project_id: projectId,
            company_id: actor.companyId,
            actor_user_id: actor.userId,
            recipient_user_ids: [bobId],
            content_snapshot: "@Bob Builder check the seam.",
            actor_name_snapshot: "Alex Author",
            project_title_snapshot: "Deck rebuild",
            created_at: new Date(
              Date.now() - 30 * 24 * 60 * 60 * 1_000
            ).toISOString(),
          });
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;

    const result = await resolveNotificationEvent({
      db,
      actor,
      request: { eventType: "mention_edit", mentionEventId },
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      reason: "Stale mention edit event",
    });
    expect(queriedTables).toEqual(["project_note_mention_events"]);
  });

  it("normalizes persisted mention markup in the original mention preview", async () => {
    const db = {
      from: (table: string) => {
        if (table === "project_notes") {
          return singleResult({
            id: noteId,
            project_id: projectId,
            company_id: actor.companyId,
            author_id: actor.userId,
            content: `@[Bob Builder](${bobId}) and @[All Team](all-team) check the seam.`,
            mentioned_user_ids: [bobId],
            created_at: new Date().toISOString(),
          });
        }
        if (table === "projects") {
          return singleResult({
            id: projectId,
            company_id: actor.companyId,
            title: "Deck rebuild",
            status: "active",
            team_member_ids: [],
            opportunity_ref: null,
            updated_at: new Date().toISOString(),
            deleted_at: null,
          });
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    } as unknown as SupabaseClient;

    const result = await resolveNotificationEvent({
      db,
      actor,
      request: { eventType: "mention", noteId },
    });

    expect(result).toEqual({
      ok: true,
      event: expect.objectContaining({
        body: "“@Bob Builder and @All Team check the seam.” on Deck rebuild",
      }),
    });
  });
});
