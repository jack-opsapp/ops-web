import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260723070000_add_opportunity_action_required_at.sql"
  ),
  "utf8"
);
const providerGuard = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260721126000_email_activity_provider_identity_guard.sql"
  ),
  "utf8"
);
const databaseTypes = readFileSync(
  path.join(process.cwd(), "src/lib/types/database.types.ts"),
  "utf8"
);

function compact(value: string): string {
  return value.replace(/\s+/g, " ").toLowerCase();
}

describe("opportunity quick-touch migration", () => {
  it("keeps local compose intent distinct from provider-backed email", () => {
    const sql = compact(migration);
    const guard = compact(providerGuard);

    expect(guard).toContain("if new.type::text = 'email'");
    expect(sql).toContain(
      "if p_type is null or p_type not in ('text_message', 'email_compose')"
    );
    expect(sql).toContain(
      "values ( v_opportunity.id, v_opportunity.company_id, p_type, btrim(p_subject), 'outbound', v_actor_user_id )"
    );
    expect(sql).not.toContain(
      "p_type not in ('text_message', 'email')"
    );
  });

  it("makes a quick touch atomic and idempotent under a private undo token", () => {
    const sql = compact(migration);

    expect(sql).toContain(
      "create table if not exists private.opportunity_quick_touch_undo"
    );
    expect(sql).toContain("request_id uuid primary key");
    expect(sql).toContain(
      "revoke all on table private.opportunity_quick_touch_undo from public, anon, authenticated, service_role"
    );
    expect(sql).toContain(
      "create or replace function public.log_opportunity_quick_touch( p_request_id uuid, p_opportunity_id uuid, p_type text, p_subject text )"
    );
    expect(sql).toContain(
      "where undo.request_id = p_request_id"
    );
    expect(sql).toContain(
      "'activity', to_jsonb(v_activity), 'opportunity', to_jsonb(v_opportunity)"
    );
    expect(sql).toContain(
      "v_activity.type is distinct from p_type or v_activity.subject is distinct from btrim(p_subject) or v_activity.direction is distinct from 'outbound'"
    );
  });

  it("rejects superseded or out-of-order undo before deleting the activity", () => {
    const sql = compact(migration);
    const superseded = sql.indexOf(
      "quick-touch has been superseded and cannot be undone out of order"
    );
    const deletion = sql.indexOf(
      "delete from public.activities where id = v_undo.activity_id"
    );

    expect(superseded).toBeGreaterThan(-1);
    expect(deletion).toBeGreaterThan(superseded);
    expect(sql).toContain(
      "v_opportunity.handled_at is distinct from v_undo.handled_at"
    );
    expect(sql).toContain(
      "set handled_at = v_undo.prior_handled_at"
    );
    expect(sql).not.toContain(
      "operator_action_required_at = v_undo.prior_operator_action_required_at"
    );
    expect(sql).not.toContain(
      "v_opportunity.last_inbound_at > v_undo.handled_at"
    );
  });

  it("blocks direct client mutation of token-backed activities", () => {
    const sql = compact(migration);

    expect(sql).toContain(
      "create policy quick_touch_activity_update_guard on public.activities as restrictive for update to anon, authenticated"
    );
    expect(sql).toContain(
      "create policy quick_touch_activity_delete_guard on public.activities as restrictive for delete to anon, authenticated"
    );
    expect(sql).toContain(
      "and not exists ( select 1 from private.opportunity_quick_touch_undo as undo where undo.activity_id = p_activity_id and undo.company_id = p_company_id and undo.undone_at is null )"
    );
    expect(sql).toContain(
      "create trigger trg_activities_invalidate_quick_touch_undo_on_reparent before update of opportunity_id, company_id on public.activities"
    );
    expect(sql).toContain(
      "update private.opportunity_quick_touch_undo set undone_at = coalesce(undone_at, statement_timestamp()) where activity_id = new.id and undone_at is null"
    );
    expect(sql).not.toContain(
      "update private.opportunity_quick_touch_undo set opportunity_id = new.opportunity_id"
    );
  });

  it("retains consumed receipts for idempotent undo and log replay rejection", () => {
    const sql = compact(migration);

    expect(sql).toContain("activity_id uuid unique not null");
    expect(sql).not.toContain(
      "references public.activities(id) on delete cascade"
    );
    expect(sql).toContain("undone_at timestamptz null");
    expect(sql).toContain(
      "if v_undo.undone_at is not null then return next v_opportunity; return; end if"
    );
    expect(sql).toContain(
      "or v_existing_undo.undone_at is not null then raise exception 'quick-touch request is invalid or already consumed'"
    );
    expect(sql).toContain(
      "create trigger trg_activities_consume_quick_touch_undo_on_delete before delete on public.activities"
    );
  });

  it("uses parent, activity, receipt lock order across replay and undo", () => {
    const sql = compact(migration);
    const undoStart = sql.indexOf(
      "create or replace function public.undo_opportunity_quick_touch"
    );
    const undo = sql.slice(undoStart);
    const activityLock = undo.indexOf(
      "from public.activities as activity where activity.id = v_undo.activity_id for update"
    );
    const receiptLock = undo.indexOf(
      "and undo.actor_user_id = v_actor_user_id for update",
      activityLock
    );

    expect(activityLock).toBeGreaterThan(-1);
    expect(receiptLock).toBeGreaterThan(activityLock);
  });

  it("takes the canonical company assignment lock before either opportunity lock", () => {
    const sql = compact(migration);
    const logStart = sql.indexOf(
      "create or replace function public.log_opportunity_quick_touch"
    );
    const undoStart = sql.indexOf(
      "create or replace function public.undo_opportunity_quick_touch"
    );
    const log = sql.slice(logStart, undoStart);
    const undo = sql.slice(undoStart);
    const opportunityLock =
      "from public.opportunities as opportunity where opportunity.id = p_opportunity_id and opportunity.company_id = v_company_id for update";
    const companyLock =
      "perform private.lock_lead_assignment_company(v_company_id)";

    expect(log.indexOf(companyLock)).toBeGreaterThan(-1);
    expect(log.indexOf(companyLock)).toBeLessThan(
      log.indexOf(opportunityLock)
    );
    expect(undo.indexOf(companyLock)).toBeGreaterThan(-1);
    expect(undo.indexOf(companyLock)).toBeLessThan(
      undo.indexOf(opportunityLock)
    );
  });

  it("indexes lifecycle cleanup and rechecks authorization after the row lock", () => {
    const sql = compact(migration);

    expect(sql).toContain(
      "create index if not exists opportunity_quick_touch_undo_opportunity_idx on private.opportunity_quick_touch_undo (opportunity_id)"
    );

    const firstLock = sql.indexOf(
      "from public.opportunities as opportunity where opportunity.id = p_opportunity_id and opportunity.company_id = v_company_id for update"
    );
    const permissionCheck = sql.indexOf(
      "if not private.user_can_edit_opportunity( v_actor_user_id, p_opportunity_id )"
    );
    expect(firstLock).toBeGreaterThan(-1);
    expect(permissionCheck).toBeGreaterThan(firstLock);
  });

  it("keeps generated RPC types aligned with the deployed signatures", () => {
    expect(databaseTypes).toMatch(
      /log_opportunity_quick_touch:\s*\{\s*Args:\s*\{\s*p_opportunity_id: string\s*p_request_id: string\s*p_subject: string\s*p_type: string\s*\}\s*Returns: Json/
    );
    expect(databaseTypes).toMatch(
      /undo_opportunity_quick_touch:\s*\{\s*Args:\s*\{\s*p_activity_id: string\s*p_opportunity_id: string\s*\}/
    );
    expect(databaseTypes).not.toMatch(
      /undo_opportunity_quick_touch:[\s\S]{0,250}p_expected_handled_at/
    );
  });
});
