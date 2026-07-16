import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260715179000_email_outbound_learning_assignment_hardening.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const compactSql = sql.replace(/\s+/g, " ");

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function ${name}`);
  if (start < 0) return "";
  const next = sql.indexOf("create or replace function ", start + 1);
  return sql.slice(start, next < 0 ? undefined : next);
}

describe("outbound-learning assignment hardening migration", () => {
  it("exists in the coordinated post-email-chain slot and is atomic", () => {
    expect(sql).not.toBe("");
    expect(sql.trimStart()).toMatch(/^begin;/);
    expect(sql.trimEnd()).toMatch(/commit;$/);
  });

  it("persists immutable actor proof and assignment snapshots on queue rows", () => {
    expect(sql).toContain("actor_proof_type");
    expect(sql).toContain("email_send_intent_id");
    expect(sql).toContain("approved_action_email_intent_id");
    expect(sql).toContain("assignment_version_snapshot");
    expect(sql).toContain("assignment_event_id_snapshot");
    expect(sql).toContain("email_outbound_learning_actor_proof_check");
  });

  it("keeps accepted OPS sends learnable after reassignment but fences inferred mailbox actors", () => {
    const guard = functionBody("private.email_outbound_learning_guard");
    expect(guard).toContain("accepted_send_intent");
    expect(guard).toContain("accepted_approved_action");
    expect(guard).toContain("native_mailbox_draft");
    expect(guard).toContain("o.assigned_to <> v_actor_id");
    expect(guard).toContain(
      "o.assignment_version <> q.assignment_version_snapshot"
    );
    expect(guard).toContain("coalesce(actor.is_active, false)");
    expect(guard).toContain("private.email_outbound_safe_uuid(q.user_id)");
    expect(guard).toContain("c.type = 'individual'");
    expect(guard).not.toContain("lower(btrim(u.email))");
  });

  it("gates enqueue, claim, prepare, apply, and promotion through the same proof", () => {
    expect(sql).toContain("private.bind_email_outbound_learning_actor_proof");
    const enqueue = functionBody("public.enqueue_email_outbound_learning");
    expect(enqueue).toContain(
      "private.bind_email_outbound_learning_actor_proof"
    );
    expect(enqueue).toContain(
      "public.enqueue_email_outbound_learning_legacy_internal"
    );
    expect(enqueue).not.toContain(
      "public.enqueue_email_outbound_learning_pre_assignment_internal("
    );
    expect(functionBody("public.claim_email_outbound_learning")).toContain(
      "private.email_outbound_learning_guard"
    );
    expect(functionBody("public.prepare_email_outbound_learning")).toContain(
      "private.email_outbound_learning_guard"
    );
    expect(functionBody("public.apply_email_outbound_learning")).toContain(
      "private.email_outbound_learning_guard"
    );
    expect(
      functionBody("public.promote_email_outbound_edit_learning")
    ).toContain("private.email_outbound_learning_guard");
  });

  it("never derives a company-mailbox actor from connector user_id or email equality", () => {
    const binder = functionBody(
      "private.bind_email_outbound_learning_actor_proof"
    );
    expect(binder).toContain("c.type = 'individual'");
    expect(binder).toContain("c.user_id ~*");
    expect(binder).toContain("c.user_id::uuid");
    expect(binder).not.toContain("c.type = 'company' and c.user_id");
    expect(binder).not.toMatch(/u\.email\s*=|from_email\s*=\s*u\.email/);
  });

  it("delegates linked and personal-mailbox permission intersections to the canonical inbox helpers", () => {
    const binder = functionBody(
      "private.bind_email_outbound_learning_actor_proof"
    );
    const guard = functionBody("private.email_outbound_learning_guard");
    const resolver = functionBody(
      "public.resolve_email_outbound_learning_mailbox_actor_as_system"
    );
    for (const body of [binder, guard, resolver]) {
      expect(body).toContain("private.user_can_send_opportunity_inbox");
      expect(body).toContain("private.user_can_send_inbox_connection");
      expect(body).not.toContain("private.user_can_edit_opportunity");
      expect(body).not.toContain("public.has_permission");
    }
  });

  it("exposes only narrow service bridges for mailbox resolution and calibration reads", () => {
    expect(sql).toContain(
      "public.resolve_email_outbound_learning_mailbox_actor_as_system"
    );
    expect(sql).toContain("public.get_human_draft_accuracy_as_system");
    expect(sql).toContain(
      "public.list_phase_c_graduation_actor_scopes_as_system"
    );
    expect(sql).toContain("to service_role");
    expect(sql).toContain("from public, anon, authenticated, service_role");
  });

  it("locks canonical assignment state before authorizing company signature mutations", () => {
    const authorize = functionBody(
      "private.authorize_email_signature_mutation"
    );
    expect(authorize).toContain("from public.users actor_row");
    expect(authorize).toContain("coalesce(actor_row.is_active, false)");
    expect(authorize).toContain("actor_row.deleted_at is null");
    expect(authorize).toContain(
      "connection_row.company_id = actor.company_id::text"
    );
    expect(authorize).toContain("connection_row.status = 'active'");
    expect(authorize).toContain("connection.type = 'individual'");
    expect(authorize).toContain(
      "private.email_outbound_safe_uuid(connection.user_id)"
    );
    expect(authorize.match(/connection\.user_id/g) ?? []).toHaveLength(1);
    expect(authorize).toContain("connection.type <> 'company'");
    expect(authorize).toContain("'settings.integrations'");
    expect(authorize).toContain("'all'");
    expect(authorize).toContain("from public.opportunities opportunity");
    expect(authorize).toContain("opportunity.deleted_at is null");
    expect(authorize).toContain("opportunity.archived_at is null");
    expect(authorize).not.toContain("opportunity.stage not in");
    expect(authorize).toContain("private.user_can_send_opportunity_inbox(");
    expect(authorize).toContain("for update");
  });

  it("fails closed when reassignment removes the locked send grant or no active lead authorizes it", () => {
    const authorize = functionBody(
      "private.authorize_email_signature_mutation"
    );
    const lock = authorize.indexOf("for update");
    const recheck = authorize.lastIndexOf(
      "private.user_can_send_opportunity_inbox("
    );
    const denial = authorize.lastIndexOf("email_signature_access_denied");
    expect(lock).toBeGreaterThan(-1);
    expect(recheck).toBeGreaterThan(lock);
    expect(denial).toBeGreaterThan(recheck);
  });

  it("exposes a service-only signature preflight through canonical inbox authorization", () => {
    const access = functionBody("private.user_can_access_email_signature");
    expect(access).toContain("from public.users actor_row");
    expect(access).toContain("coalesce(actor_row.is_active, false)");
    expect(access).toContain("connection_row.status = 'active'");
    expect(access).toContain("connection.type = 'individual'");
    expect(access).toContain(
      "private.email_outbound_safe_uuid(connection.user_id)"
    );
    expect(access).toContain("connection.type <> 'company'");
    expect(access).toContain("'settings.integrations'");
    expect(access).toContain("private.user_can_send_opportunity_inbox(");
    expect(access).not.toContain("opportunity.assigned_to = p_actor_user_id");

    const bridge = functionBody(
      "public.authorize_email_signature_access_as_system"
    );
    expect(bridge).toContain("auth.role() is distinct from 'service_role'");
    expect(bridge).toContain("private.user_can_access_email_signature(");
    expect(compactSql).toContain(
      "revoke all on function public.authorize_email_signature_access_as_system( uuid, uuid ) from public, anon, authenticated, service_role"
    );
    expect(compactSql).toContain(
      "grant execute on function public.authorize_email_signature_access_as_system( uuid, uuid ) to service_role"
    );
  });

  it("derives actor signature scope and mailbox provider identity inside guarded service RPCs", () => {
    const replace = functionBody("public.replace_email_signature_as_system");
    expect(replace).toContain("auth.role() is distinct from 'service_role'");
    expect(replace).toContain("private.authorize_email_signature_mutation(");
    expect(replace).toContain("v_scope_user_id := p_actor_user_id");
    expect(replace).toContain("v_scope_user_id := null");
    expect(replace).toContain("lower(btrim(v_connection.email))");
    expect(replace).toContain("public.replace_email_signature(");
    expect(replace).not.toContain("p_company_id uuid");
    expect(replace).not.toContain("p_scope_user_id uuid");

    const deactivate = functionBody(
      "public.deactivate_email_signature_as_system"
    );
    expect(deactivate).toContain("private.authorize_email_signature_mutation(");
    expect(deactivate).toContain("s.scope_user_id = p_actor_user_id");
    expect(deactivate).toContain("s.scope_user_id is null");
    expect(deactivate).toContain(
      "lower(btrim(s.provider_identity)) = lower(btrim(v_connection.email))"
    );
    expect(deactivate).toContain("set active = false");
  });

  it("keeps signature mutation RPCs service-role-only", () => {
    expect(compactSql).toContain(
      "revoke all on function public.replace_email_signature( uuid, uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, uuid ) from public, anon, authenticated, service_role"
    );
    expect(compactSql).toContain(
      "revoke insert, update, delete on table public.email_signatures from service_role"
    );
    expect(compactSql).toContain(
      "revoke all on function public.replace_email_signature_as_system( uuid, uuid, text, text, text, text, text, timestamptz, timestamptz ) from public, anon, authenticated, service_role"
    );
    expect(compactSql).toContain(
      "grant execute on function public.replace_email_signature_as_system( uuid, uuid, text, text, text, text, text, timestamptz, timestamptz ) to service_role"
    );
    expect(compactSql).toContain(
      "revoke all on function public.deactivate_email_signature_as_system( uuid, uuid, uuid, text ) from public, anon, authenticated, service_role"
    );
    expect(compactSql).toContain(
      "grant execute on function public.deactivate_email_signature_as_system( uuid, uuid, uuid, text ) to service_role"
    );
  });

  it("binds mailbox actor inference to the exact outbound activity and rejects lead conflicts", () => {
    const resolver = functionBody(
      "public.resolve_email_outbound_learning_mailbox_actor_as_system"
    );
    const binder = functionBody(
      "private.bind_email_outbound_learning_actor_proof"
    );
    const guard = functionBody("private.email_outbound_learning_guard");
    expect(resolver).toContain("p_provider_message_id text");
    expect(resolver).toContain("from public.activities outbound");
    expect(resolver).toContain(
      "outbound.email_message_id = btrim(p_provider_message_id)"
    );
    expect(resolver).toContain(
      "outbound.email_thread_id = btrim(p_provider_thread_id)"
    );
    expect(resolver).toContain(
      "d.opportunity_id is distinct from activity.opportunity_id"
    );
    expect(resolver).toMatch(
      /coalesce\(\s*d\.opportunity_id,\s*activity\.opportunity_id\s*\)/
    );
    for (const guardedBody of [binder, guard]) {
      expect(guardedBody).toContain("from public.activities outbound");
      expect(guardedBody).toContain(
        "outbound.email_message_id = q.provider_message_id"
      );
      expect(guardedBody).toContain(
        "q.opportunity_id is distinct from activity.opportunity_id"
      );
      expect(guardedBody).toContain(
        "d.opportunity_id is distinct from activity.opportunity_id"
      );
    }
  });
});
