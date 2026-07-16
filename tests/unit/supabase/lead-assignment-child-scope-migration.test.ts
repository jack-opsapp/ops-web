import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260715160700_lead_assignment_child_scope.sql"
);

function sql(): string {
  return existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
}

function functionBody(source: string, name: string): string {
  const marker = `create or replace function ${name}`;
  const lower = source.toLowerCase();
  const start = lower.indexOf(marker);
  expect(start, `${name} missing`).toBeGreaterThanOrEqual(0);
  const next = lower.indexOf(
    "create or replace function ",
    start + marker.length
  );
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

function tablePolicy(source: string, table: string, policy: string): string {
  const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedPolicy = policy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `create\\s+policy\\s+${escapedPolicy}\\s+on\\s+public\\.${escapedTable}[\\s\\S]*?;`,
      "i"
    )
  );
  expect(match, `${table}.${policy} missing`).not.toBeNull();
  return match?.[0] ?? "";
}

describe("lead-assignment child-scope migration", () => {
  it("lands in the reserved 160700 slot as one transaction", () => {
    const source = sql();

    expect(source.length).toBeGreaterThan(0);
    expect(path.basename(migrationPath)).toBe(
      "20260715160700_lead_assignment_child_scope.sql"
    );
    expect(source).toMatch(/(?:^|\n)begin\s*;/i);
    expect(source).toMatch(/commit\s*;\s*$/i);
  });

  it("defines fixed-path, revoke-safe inbox and parent-domain helpers", () => {
    const source = sql();
    const helpers = [
      "private.should_use_inbox_view_company_compat",
      "private.effective_inbox_scope_for_user",
      "private.user_can_view_opportunity_inbox",
      "private.user_can_send_opportunity_inbox",
      "private.opportunity_project_relationship_is_valid",
      "private.current_user_can_view_activity",
      "private.current_user_can_edit_activity",
      "private.current_user_can_view_activity_comment",
      "private.current_user_can_edit_activity_comment",
      "private.current_user_can_view_site_visit",
      "private.current_user_can_edit_site_visit",
      "private.current_user_can_view_deck_design",
      "private.current_user_can_edit_deck_design",
      "private.current_user_can_view_email_thread_correction",
      "private.current_user_can_edit_email_thread_correction",
      "private.current_user_can_view_duplicate_review",
    ];

    for (const helper of helpers) {
      const body = functionBody(source, helper);
      expect(body, helper).toMatch(/security definer/i);
      expect(body, helper).toMatch(
        /set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'/i
      );
      expect(source, helper).toMatch(
        new RegExp(
          `revoke all on function ${helper.replace(".", "\\.")}\\([\\s\\S]*?from public, anon, authenticated, service_role`,
          "i"
        )
      );
    }

    const inbox = functionBody(
      source,
      "private.effective_inbox_scope_for_user"
    );
    expect(inbox).toMatch(
      /p_permission not in \('inbox\.view', 'inbox\.send'\)/i
    );
    expect(inbox).toMatch(/public\.has_permission\([\s\S]*?'all'/i);
    expect(inbox).toMatch(/public\.has_permission\([\s\S]*?'assigned'/i);
    expect(inbox).toMatch(/p_permission = 'inbox\.view'[\s\S]*?'own'/i);
    expect(inbox).toMatch(/should_use_inbox_view_company_compat/i);
    expect(inbox).not.toMatch(/email\s*=|lower\([^)]*email/i);

    const compatibility = functionBody(
      source,
      "private.should_use_inbox_view_company_compat"
    );
    expect(compatibility).toMatch(/public\.user_permission_overrides/i);
    expect(compatibility).not.toMatch(
      /not upo\.granted or upo\.scope is not null/i
    );

    const connectionView = functionBody(
      source,
      "private.user_can_view_inbox_connection"
    );
    expect(connectionView).toMatch(
      /v_scope = 'assigned'[\s\S]*?ec\.type::text\s*=\s*'individual'[\s\S]*?ec\.user_id[\s\S]*?p_actor_user_id::text[\s\S]*?or[\s\S]*?o\.assigned_to = p_actor_user_id/i
    );
    expect(connectionView).toMatch(
      /v_scope = 'own'[\s\S]*?ec\.type::text\s*=\s*'individual'[\s\S]*?ec\.user_id[\s\S]*?p_actor_user_id::text/i
    );

    const connectionSend = functionBody(
      source,
      "private.user_can_send_inbox_connection"
    );
    expect(connectionSend).toMatch(
      /ec\.type::text[\s\S]*?ec\.user_id[\s\S]*?v_connection_type = 'individual'[\s\S]*?v_connection_user_id is distinct from p_actor_user_id::text[\s\S]*?return false/i
    );
  });

  it("delegates assignment and conversion audit reads to canonical lead view while preserving recipient delivery", () => {
    const source = sql();

    for (const table of [
      "opportunity_assignment_events",
      "opportunity_assignment_suggestions",
      "opportunity_conversion_events",
    ]) {
      const policy = tablePolicy(source, table, "authorized_lead_select");
      expect(policy).toMatch(/for select\s+to public/i);
      expect(policy).toMatch(
        /current_user_can_view_opportunity\(opportunity_id\)/i
      );
    }

    const delivery = tablePolicy(
      source,
      "opportunity_assignment_deliveries",
      "recipient_select"
    );
    expect(delivery).toMatch(
      /recipient_user_id\s*=\s*private\.get_current_user_id\(\)/i
    );
    expect(delivery).not.toMatch(/current_user_can_view_opportunity/i);
  });

  it("makes stage history parent-scoped and append-only for ordinary callers", () => {
    const source = sql();
    const select = tablePolicy(
      source,
      "stage_transitions",
      "assigned_lead_scope_select"
    );
    const insert = tablePolicy(
      source,
      "stage_transitions",
      "assigned_lead_scope_insert"
    );

    expect(select).toMatch(
      /as restrictive[\s\S]*?for select[\s\S]*?to public/i
    );
    expect(select).toMatch(
      /current_user_can_view_opportunity\(opportunity_id\)/i
    );
    expect(insert).toMatch(
      /as restrictive[\s\S]*?for insert[\s\S]*?to public/i
    );
    expect(insert).toMatch(
      /current_user_can_edit_opportunity\(opportunity_id\)/i
    );
    expect(source).toMatch(
      /revoke update, delete on table public\.stage_transitions\s+from anon, authenticated, service_role/i
    );
    expect(source).not.toMatch(
      /create\s+policy\s+assigned_lead_scope_(?:update|delete)\s+on\s+public\.stage_transitions/i
    );
  });

  it("scopes conditional children without treating a shared client as authorization", () => {
    const source = sql();

    for (const table of [
      "activities",
      "follow_ups",
      "site_visits",
      "deck_designs",
    ]) {
      expect(source).toMatch(
        new RegExp(
          `create\\s+policy\\s+assigned_lead_scope_select\\s+on\\s+public\\.${table}[\\s\\S]*?as restrictive[\\s\\S]*?for select[\\s\\S]*?to public`,
          "i"
        )
      );
    }

    const activityView = functionBody(
      source,
      "private.current_user_can_view_activity"
    );
    expect(activityView).toMatch(/user_can_view_opportunity/i);
    expect(activityView).toMatch(/user_can_view_project/i);
    expect(activityView).toMatch(/user_can_view_inbox_connection/i);
    expect(activityView).not.toMatch(/client_id/i);

    const visitView = functionBody(
      source,
      "private.current_user_can_view_site_visit"
    );
    expect(visitView).toMatch(/user_can_view_opportunity/i);
    expect(visitView).toMatch(/user_can_view_project/i);
    expect(visitView).toMatch(/\bor\b/i);
    expect(visitView).not.toMatch(/client_id/i);

    const deckEdit = functionBody(
      source,
      "private.current_user_can_edit_deck_design"
    );
    expect(deckEdit).toMatch(/deck_builder\.edit/i);
    expect(deckEdit).toMatch(/user_can_edit_opportunity/i);
    expect(deckEdit).toMatch(/user_can_edit_project/i);
    expect(deckEdit).toMatch(
      /p_opportunity_id is null and p_project_id is null[\s\S]*?has_permission[\s\S]*?'all'/i
    );
    expect(deckEdit).toMatch(/has_permission[\s\S]*?'assigned'/i);

    const deckView = functionBody(
      source,
      "private.current_user_can_view_deck_design"
    );
    expect(deckView).toMatch(
      /p_opportunity_id is null and p_project_id is null[\s\S]*?deck_builder\.view[\s\S]*?'all'/i
    );
    expect(deckView).toMatch(/deck_builder\.view[\s\S]*?'assigned'/i);
  });

  it("rejects mismatched dual-parent writes while preserving either authorized parent path", () => {
    const source = sql();
    const relationship = functionBody(
      source,
      "private.opportunity_project_relationship_is_valid"
    );

    expect(relationship).toMatch(
      /from public\.opportunities o[\s\S]*?join public\.projects p/i
    );
    expect(relationship).toMatch(
      /o\.project_ref\s*=\s*p\.id[\s\S]*?o\.project_id\s*=\s*p\.id/i
    );
    expect(relationship).toMatch(
      /p\.opportunity_ref\s*=\s*o\.id[\s\S]*?try_parse_uuid\(p\.opportunity_id\)\s*=\s*o\.id/i
    );

    for (const helper of [
      "private.current_user_can_edit_activity",
      "private.current_user_can_edit_site_visit",
      "private.current_user_can_edit_deck_design",
    ]) {
      const body = functionBody(source, helper);
      expect(body, helper).toMatch(
        /p_opportunity_id is not null[\s\S]*?p_project_id is not null[\s\S]*?opportunity_project_relationship_is_valid[\s\S]*?return false/i
      );
      expect(body, helper).toMatch(/user_can_edit_opportunity/i);
      expect(body, helper).toMatch(/user_can_edit_project/i);
    }
  });

  it("scopes activity comments through the parent activity for every CRUD operation", () => {
    const source = sql();
    const view = functionBody(
      source,
      "private.current_user_can_view_activity_comment"
    );
    const edit = functionBody(
      source,
      "private.current_user_can_edit_activity_comment"
    );

    expect(view).toMatch(/from public\.activities a/i);
    expect(view).toMatch(/current_user_can_view_activity/i);
    expect(edit).toMatch(/from public\.activities a/i);
    expect(edit).toMatch(/current_user_can_edit_activity/i);

    for (const operation of ["select", "insert", "update", "delete"] as const) {
      const policy = tablePolicy(
        source,
        "activity_comments",
        `assigned_parent_scope_${operation}`
      );
      expect(policy).toMatch(/as restrictive/i);
      expect(policy).toMatch(
        operation === "select"
          ? /current_user_can_view_activity_comment\(company_id, activity_id\)/i
          : /current_user_can_edit_activity_comment\(company_id, activity_id\)/i
      );
      if (operation === "update") {
        expect(policy).toMatch(/using[\s\S]*?with check/i);
      }
    }
  });

  it("scopes category corrections through their thread and requires actor-owned authorized writes", () => {
    const source = sql();
    const view = functionBody(
      source,
      "private.current_user_can_view_email_thread_correction"
    );
    const edit = functionBody(
      source,
      "private.current_user_can_edit_email_thread_correction"
    );

    expect(view).toMatch(/from public\.email_threads et/i);
    expect(view).toMatch(/current_user_can_view_email_thread/i);
    expect(edit).toMatch(/from public\.email_threads et/i);
    expect(edit).toMatch(/user_can_send_opportunity_inbox/i);
    expect(edit).toMatch(/user_can_send_inbox_connection/i);
    expect(source).toMatch(
      /drop policy if exists corrections_company_scope\s+on public\.email_thread_category_corrections/i
    );

    const select = tablePolicy(
      source,
      "email_thread_category_corrections",
      "lead_inbox_scope_select"
    );
    expect(select).toMatch(
      /current_user_can_view_email_thread_correction\(company_id, thread_id\)/i
    );

    for (const operation of ["insert", "update", "delete"] as const) {
      const policy = tablePolicy(
        source,
        "email_thread_category_corrections",
        `lead_inbox_scope_${operation}`
      );
      expect(policy).toMatch(
        /current_user_can_edit_email_thread_correction\(company_id, thread_id\)/i
      );
      expect(policy).toMatch(/user_id\s*=\s*private\.get_current_user_id\(\)/i);
      if (operation === "update") {
        expect(policy).toMatch(/using[\s\S]*?with check/i);
      }
    }
  });

  it("scopes provenance, lifecycle, dispositions, merges, and duplicate reviews without sibling references", () => {
    const source = sql();

    for (const table of [
      "lead_field_provenance",
      "opportunity_lifecycle_state",
      "opportunity_lifecycle_action_audit",
      "opportunity_dispositions",
      "opportunity_merges",
      "duplicate_reviews",
    ]) {
      expect(source, table).toMatch(
        new RegExp(`create\\s+policy[\\s\\S]*?on\\s+public\\.${table}`, "i")
      );
    }

    const dispositions = tablePolicy(
      source,
      "opportunity_dispositions",
      "authorized_lead_select"
    );
    expect(dispositions).toMatch(
      /current_user_can_view_opportunity\(opportunity_id\)/i
    );
    expect(dispositions).toMatch(
      /merged_into_opportunity_id is null[\s\S]*?current_user_can_view_opportunity\(merged_into_opportunity_id\)/i
    );
    expect(dispositions).toMatch(
      /converted_project_ref is null[\s\S]*?current_user_can_view_project_reference/i
    );

    const mergeView = functionBody(
      source,
      "private.current_user_can_view_opportunity_merge"
    );
    expect(mergeView).toMatch(
      /effective_pipeline_scope_for_user[\s\S]*?'pipeline\.view'[\s\S]*?= 'all'/i
    );
    expect(mergeView).toMatch(/user_can_view_opportunity[\s\S]*?p_winner_id/i);
    expect(mergeView).toMatch(/user_can_view_opportunity[\s\S]*?p_loser_id/i);

    const duplicate = functionBody(
      source,
      "private.current_user_can_view_duplicate_review"
    );
    expect(duplicate).toMatch(/when 'opportunity'/i);
    expect(duplicate).toMatch(/when 'client'/i);
    expect(duplicate).toMatch(/when 'project'/i);
    expect(duplicate).toMatch(/when 'task'/i);
  });

  it("intersects lead and inbox scope and leaves provider queues server-only", () => {
    const source = sql();

    for (const table of [
      "opportunity_correspondence_events",
      "opportunity_follow_up_drafts",
      "email_threads",
      "opportunity_email_threads",
    ]) {
      const policy = tablePolicy(source, table, "lead_inbox_scope_select");
      expect(policy).toMatch(/for select\s+to public/i);
      expect(policy).toMatch(/opportunity_inbox|email_thread/i);
    }

    const draft = tablePolicy(
      source,
      "opportunity_follow_up_drafts",
      "lead_inbox_scope_select"
    );
    expect(draft).toMatch(/current_user_can_send_opportunity_inbox/i);
    expect(source).toMatch(
      /drop policy if exists opportunity_correspondence_events_company_select[\s\S]*?on public\.opportunity_correspondence_events/i
    );
    expect(source).toMatch(
      /drop policy if exists opportunity_follow_up_drafts_company_select[\s\S]*?on public\.opportunity_follow_up_drafts/i
    );

    expect(source).toMatch(
      /revoke insert, update, delete on table public\.email_threads\s+from anon, authenticated/i
    );
    expect(source).toMatch(
      /revoke insert, update, delete on table public\.opportunity_email_threads\s+from anon, authenticated/i
    );
    expect(source).toMatch(
      /revoke all on table public\.ai_draft_history\s+from public, anon, authenticated/i
    );
    expect(source).toMatch(
      /revoke all on table public\.pending_auto_sends\s+from public, anon, authenticated/i
    );
    expect(source).toMatch(
      /revoke all on table public\.email_attachments\s+from public, anon, authenticated/i
    );
    expect(source).toMatch(
      /revoke all on table public\.email_outbound_learning_queue\s+from public, anon, authenticated/i
    );
  });

  it("guards child reparenting with consumed database tokens and only the reviewed merge/review seams", () => {
    const source = sql();
    const guard = functionBody(
      source,
      "private.guard_opportunity_child_reparent"
    );

    expect(source).toMatch(
      /create table private\.opportunity_child_reparent_tokens/i
    );
    expect(source).toMatch(
      /revoke all on table private\.opportunity_child_reparent_tokens\s+from public, anon, authenticated, service_role/i
    );
    expect(guard).toMatch(
      /delete from private\.opportunity_child_reparent_tokens/i
    );
    expect(guard).toMatch(/child_reparent_forbidden/i);
    expect(guard).not.toMatch(/current_setting\(/i);

    for (const table of [
      "activities",
      "follow_ups",
      "stage_transitions",
      "site_visits",
      "deck_designs",
      "opportunity_correspondence_events",
      "opportunity_follow_up_drafts",
      "opportunity_lifecycle_state",
      "opportunity_lifecycle_action_audit",
      "email_threads",
      "opportunity_email_threads",
    ]) {
      expect(source, table).toMatch(
        new RegExp(
          `create trigger trg_${table}_guard_opportunity_reparent[\\s\\S]*?on public\\.${table}[\\s\\S]*?execute function private\\.guard_opportunity_child_reparent`,
          "i"
        )
      );
    }

    expect(source).toMatch(
      /execute_opportunity_merge_guarded_child_scope_internal/i
    );
    expect(source).toMatch(
      /reassign_opportunity_email_thread_guarded_child_scope_internal/i
    );
    expect(source).toMatch(
      /insert into private\.opportunity_child_reparent_tokens/i
    );
  });

  it("exposes only whitelisted lead context instead of widening raw domain tables", () => {
    const source = sql();
    const context = functionBody(
      source,
      "public.get_opportunity_assigned_context"
    );

    expect(context).toMatch(
      /current_user_can_view_opportunity\(p_opportunity_id\)/i
    );
    expect(context).toMatch(/from public\.clients/i);
    expect(context).toMatch(/from public\.estimates/i);
    expect(context).toMatch(/e\.opportunity_id = p_opportunity_id/i);
    expect(context).toMatch(/'contact'/i);
    expect(context).toMatch(/'estimate_summaries'/i);
    expect(context).toMatch(/'activities'/i);
    expect(context).toMatch(/'follow_ups'/i);
    expect(context).toMatch(/'site_visits'/i);
    expect(context).toMatch(/'deck_designs'/i);
    expect(context).toMatch(/'correspondence'/i);
    expect(context).toMatch(/'activity_id'\s*,\s*ce\.activity_id/i);
    expect(context).not.toMatch(
      /to_jsonb\(c\)|to_jsonb\(e\)|c\.notes|e\.internal_notes|e\.qb_id|e\.sage_id/i
    );

    expect(source).not.toMatch(
      /create\s+policy[\s\S]*?on\s+public\.(?:clients|estimates|invoices|projects|qbo_estimate_opportunity_links)/i
    );
    expect(source).not.toMatch(
      /(?:grant|revoke)[^;]*on table public\.(?:clients|estimates|invoices|projects|qbo_estimate_opportunity_links)/i
    );
  });

  it("returns minimal assignment candidates and exposes unassign only to all scope", () => {
    const source = sql();
    const candidates = functionBody(
      source,
      "public.list_opportunity_assignment_candidates"
    );

    expect(source).toMatch(
      /create or replace function public\.list_opportunity_assignment_candidates\(\s*p_opportunity_id uuid\s*\) returns jsonb/i
    );
    expect(candidates).toMatch(
      /current_user_can_assign_opportunity\(p_opportunity_id\)/i
    );
    expect(candidates).toMatch(
      /effective_pipeline_scope_for_user[\s\S]*?'pipeline\.assign'/i
    );
    expect(candidates).toMatch(/v_scope = 'all'[\s\S]*?'can_unassign'/i);
    expect(candidates).toMatch(
      /v_scope = 'assigned'[\s\S]*?archived_at[\s\S]*?stage in \('won', 'lost', 'discarded'\)/i
    );
    expect(candidates).toMatch(/u\.company_id = v_opportunity\.company_id/i);
    expect(candidates).toMatch(/u\.deleted_at is null/i);
    expect(candidates).toMatch(/coalesce\(u\.is_active, false\)/i);
    expect(candidates).toMatch(
      /public\.has_permission\([\s\S]*?'pipeline\.view'[\s\S]*?'assigned'/i
    );
    for (const field of [
      "id",
      "first_name",
      "last_name",
      "profile_image_url",
      "user_color",
    ]) {
      expect(candidates).toMatch(new RegExp(`'${field}'`, "i"));
    }
    expect(candidates).not.toMatch(
      /u\.email|mailbox|team_member_ids|project_tasks/i
    );
    expect(source).toMatch(
      /revoke all on function public\.list_opportunity_assignment_candidates\(uuid\)\s+from public, anon, authenticated, service_role[\s\S]*?grant execute on function public\.list_opportunity_assignment_candidates\(uuid\)\s+to anon, authenticated/i
    );
  });
});
