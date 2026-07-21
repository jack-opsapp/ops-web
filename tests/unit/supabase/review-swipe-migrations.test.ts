import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function migration(name: string): string {
  return readFileSync(
    join(process.cwd(), "supabase", "migrations", name),
    "utf8"
  ).toLowerCase();
}

describe("review swipe database boundaries", () => {
  it("keeps payment write-off on the invoice-to-project lock order", () => {
    const sql = migration("20260721120000_payment_review_atomic_actions.sql");
    const writeOff = sql.slice(
      sql.indexOf(
        "create or replace function public.write_off_project_from_payment_review"
      )
    );
    const invoiceLock = writeOff.indexOf("order by invoice.id\n   for update");
    const invoiceMutation = writeOff.indexOf("update public.invoices invoice");
    const projectLock = writeOff.indexOf(
      "from public.projects\n   where id = p_project_id\n     and company_id = v_company_id\n     and deleted_at is null\n   for update"
    );

    expect(invoiceLock).toBeGreaterThan(0);
    expect(invoiceMutation).toBeGreaterThan(invoiceLock);
    expect(projectLock).toBeGreaterThan(invoiceMutation);

    const receiptLookups = [
      ...writeOff.matchAll(
        /from public\.payment_review_writeoff_receipts receipt/g
      ),
    ].map((match) => match.index ?? -1);
    expect(receiptLookups).toHaveLength(2);
    expect(receiptLookups[1]).toBeGreaterThan(invoiceLock);
    expect(receiptLookups[1]).toBeLessThan(invoiceMutation);

    const providerFences = [
      ...writeOff.matchAll(
        /message = 'external_accounting_writeoff_required'/g
      ),
    ].map((match) => match.index ?? -1);
    expect(providerFences).toHaveLength(2);
    expect(providerFences[0]).toBeGreaterThan(receiptLookups[1]);
    expect(providerFences[0]).toBeLessThan(invoiceMutation);
    expect(providerFences[1]).toBeGreaterThan(projectLock);

    const firstProviderFence = writeOff.slice(
      writeOff.lastIndexOf("if exists (", providerFences[0]),
      providerFences[0]
    );
    expect(firstProviderFence).toContain(
      "coalesce(invoice.balance_due, 0) > 0"
    );
    expect(firstProviderFence).toContain(
      "invoice.qb_id is not null or invoice.sage_id is not null"
    );
    expect(firstProviderFence).not.toContain("invoice.status in");
    expect(writeOff).toContain("message = 'invoice_set_changed'");
    expect(writeOff).toContain(
      "message = 'external_accounting_writeoff_required'"
    );
    expect(sql).toContain("coalesce(invoice.project_ref, invoice.project_id)");
    expect(sql).toContain(
      "before insert or update of company_id, project_id, project_ref, balance_due, status, deleted_at"
    );
    expect(sql).toContain("using errcode = '23514'");
    expect(sql).toContain("using errcode = '23503'");
    expect(sql).toContain("and project.deleted_at is null\n   for update;");
    expect(sql).toContain("payment_review_writeoff_receipts");
    expect(sql).toContain("p_idempotency_key uuid");
    expect(sql).toContain("private.lock_lead_assignment_company(v_company_id)");
    expect(sql).toContain(
      "private.user_can_edit_project(v_actor_user_id, p_project_id)"
    );
    expect(sql).toContain(
      "public.has_permission(v_actor_user_id, 'finances.view', 'all')"
    );
    expect(sql).not.toContain("private.current_user_has_permission");
    expect(sql).not.toContain("private.current_user_can_edit_project");

    const closeProject = sql.slice(
      sql.indexOf(
        "create or replace function public.close_project_from_payment_review"
      ),
      sql.indexOf(
        "create or replace function public.write_off_project_from_payment_review"
      )
    );
    const closeProjectLock = closeProject.indexOf(
      "from public.projects\n   where id = p_project_id\n     and company_id = v_company_id\n     and deleted_at is null\n   for update"
    );
    const closeProviderFence = closeProject.indexOf(
      "message = 'external_accounting_writeoff_required'"
    );
    expect(closeProjectLock).toBeGreaterThan(0);
    expect(closeProviderFence).toBeGreaterThan(closeProjectLock);
    expect(closeProject.slice(closeProjectLock, closeProviderFence)).toContain(
      "invoice.qb_id is not null or invoice.sage_id is not null"
    );

    const paidCascade = sql.slice(
      sql.indexOf(
        "create or replace function public.close_project_when_fully_paid"
      ),
      sql.indexOf(
        "create or replace function public.close_project_from_payment_review"
      )
    );
    expect(paidCascade).toContain(
      "coalesce(invoice.project_ref, invoice.project_id) = v_project_id"
    );

    const receiptIndexes = migration(
      "20260721123000_payment_review_receipt_fk_indexes.sql"
    );
    expect(receiptIndexes).toContain(
      "payment_review_writeoff_receipts_project_id_idx"
    );
    expect(receiptIndexes).toContain(
      "payment_review_writeoff_receipts_actor_user_id_idx"
    );
  });

  it("deduplicates paid draft generation and revalidates invoices at delivery", () => {
    const sql = migration(
      "20260721122000_payment_reminder_delivery_guards.sql"
    );

    expect(sql).toContain("claim_payment_reminder_generation");
    expect(sql).toContain("'generation_in_progress'");
    expect(sql).toContain("'existing_action'");
    expect(sql).toContain(
      "action.status in ('pending', 'approved', 'executed', 'rejected')"
    );
    expect(sql).toContain("agent_actions_payment_reminder_active_unique");
    expect(sql).toContain("private.payment_reminder_email_intent_is_current");
    expect(sql).toContain("invoice_updated_at");
    expect(sql).toContain("now() at time zone v_company_timezone");
    expect(sql).toContain("company.client_comms_settings");
    expect(sql).toContain("feature.feature_key = 'phase_c'");
    expect(sql).toContain("lower(btrim(coalesce(v_intent.to_emails[1], '')))");
    expect(sql).toContain("private.task_automation_email_intent_is_current");
    expect(sql).toContain("private.approved_action_email_intent_is_authorized");
    expect(sql).toContain(
      "private.permission_user_is_admin(\n    v_intent.actor_user_id"
    );
    expect(sql).toContain(
      "public.has_permission(v_intent.actor_user_id, 'invoices.send', 'all')"
    );
    expect(sql).toContain("payment_reminder_settings_snapshot");
    expect(sql).toContain("v_company_today - v_invoice.due_date");
    expect(sql).toContain(
      "if v_intent.project_id is not null and not private.user_can_edit_project"
    );
    expect(sql).not.toContain(
      "create or replace function private.approved_action_email_intent_is_authorized"
    );
  });

  it("requires action-specific permissions for unassigned review mutations", () => {
    const sql = migration("20260721121000_review_swipe_task_mutations.sql");

    expect(sql).toContain(
      "public.has_permission(v_actor_user_id, 'tasks.assign'"
    );
    expect(sql).toContain(
      "private.user_can_change_task_status(v_actor_user_id, p_task_id)"
    );
    expect(sql).toContain(
      "public.has_permission(v_actor_user_id, 'calendar.edit'"
    );
    expect(sql).toContain("v_patch jsonb := coalesce(p_patch, '{}'::jsonb)");
    expect(sql).toContain("or p_action is null");
    expect(sql).toContain("select distinct member_id::uuid");
    expect(sql).toContain("review_assignment_requires_crew");
    expect(sql).toContain(
      "jsonb_typeof(v_patch -> 'start_date') is distinct from 'string'"
    );
    expect(sql).toContain("not (v_patch ? 'schedule_locked')");
    expect(sql).toContain("v_patch - 'schedule_locked'");
    expect(sql).toContain(
      "set schedule_locked = (v_patch ->> 'schedule_locked')::boolean"
    );
    expect(sql).toContain(
      "if not found then\n    raise exception using errcode = 'p0002', message = 'review_task_not_found'"
    );
    expect(sql).toContain("private.update_task_with_event_for_actor");
    expect(sql).toContain("public.complete_project_task");

    const authorization = sql.indexOf(
      "if not private.user_can_edit_task(v_actor_user_id, p_task_id)"
    );
    const terminalResponse = sql.indexOf("if v_task.status <> 'active'");
    const conflictResponse = sql.indexOf(
      "if v_task.updated_at is distinct from p_expected_updated_at"
    );
    expect(authorization).toBeGreaterThan(0);
    expect(terminalResponse).toBeGreaterThan(authorization);
    expect(conflictResponse).toBeGreaterThan(authorization);

    const terminalCompletion = sql.indexOf(
      "if p_action = 'complete' and v_task.status = 'completed'"
    );
    const projectLifecycle = sql.indexOf(
      "if v_project_status not in ('accepted', 'in_progress')"
    );
    expect(terminalCompletion).toBeGreaterThan(authorization);
    expect(projectLifecycle).toBeGreaterThan(terminalCompletion);
    expect(
      sql.indexOf(
        "v_result := public.complete_project_task",
        terminalCompletion
      )
    ).toBeLessThan(projectLifecycle);
  });
});
