import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260727193418_phase_c_lead_disposition_feedback.sql"
);
const sql = readFileSync(migrationPath, "utf8").toLowerCase();
const compact = sql.replace(/\s+/g, " ");

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function ${name}`);
  expect(start, `missing ${name}`).toBeGreaterThanOrEqual(0);
  const next = sql.indexOf("create or replace function ", start + 1);
  return next === -1 ? sql.slice(start) : sql.slice(start, next);
}

describe("Phase C lead-disposition feedback migration", () => {
  it("creates append-history feedback and durable future-classification review records", () => {
    expect(sql).toContain("create table public.lead_disposition_feedback");
    expect(sql).toContain("create table public.lead_classification_reviews");
    expect(compact).toContain(
      "unique (company_id, actor_user_id, apply_idempotency_key)"
    );
    expect(compact).toContain(
      "unique (company_id, connection_id, provider_message_id)"
    );
    expect(sql).toContain("source_connection_id");
    expect(sql).toContain("source_provider_thread_id");
    expect(sql).toContain("source_message_id");
    expect(sql).toContain("source_thread_key");
    expect(sql).toContain("sender_email");
    expect(sql).toContain("sender_domain");
    expect(sql).toContain("participants_hash");
    expect(sql).toContain("model_context");
    expect(sql).toContain("policy_context");
    expect(sql).toContain("learning_state");
    expect(sql).toContain("retracted_at");
  });

  it("allows only the canonical reason and outcome vocabulary", () => {
    for (const reason of [
      "spam",
      "job_applicant",
      "vendor_sales",
      "internal",
      "platform_notification",
      "test_traffic",
      "duplicate",
      "not_a_fit",
      "other",
      "legacy_unspecified",
    ]) {
      expect(sql).toContain(`'${reason}'`);
    }
    for (const outcome of [
      "discarded",
      "lost",
      "duplicate_review",
      "review_deferred",
    ]) {
      expect(sql).toContain(`'${outcome}'`);
    }
  });

  it("enables row security, exposes authorized reads, and revokes every direct write", () => {
    expect(compact).toContain(
      "alter table public.lead_disposition_feedback enable row level security"
    );
    expect(compact).toContain(
      "create policy lead_disposition_feedback_select on public.lead_disposition_feedback for select to anon, authenticated using (private.current_user_can_view_opportunity(opportunity_id))"
    );
    expect(compact).toContain(
      "revoke insert, update, delete on table public.lead_disposition_feedback from public, anon, authenticated"
    );
    expect(compact).toContain(
      "revoke all on table public.lead_classification_reviews from public, anon, authenticated"
    );
  });

  it("derives actor, company, evidence, Phase C state, and outcome on the server", () => {
    const apply = functionBody("public.apply_lead_disposition_feedback");

    expect(apply).toContain("private.get_current_user_id()");
    expect(apply).toContain(
      "private.current_user_can_edit_opportunity(p_opportunity_id)"
    );
    expect(apply).toContain("from public.admin_feature_overrides");
    expect(apply).toContain("feature_key = 'phase_c'");
    expect(apply).toContain("for update");
    expect(apply).toContain("from public.email_threads");
    expect(apply).toContain("from public.opportunity_email_threads");
    expect(apply).toContain(
      "thread.provider_thread_id = v_source_provider_thread_id"
    );
    expect(apply).toContain("v_thread.connection_id");
    expect(apply).toContain(
      "split_part(v_opportunity.source_thread_key, ':thread:', 2)"
    );
    expect(apply).toContain("v_source_thread_candidate_count = 1");
    expect(apply).toContain("v_opportunity.contact_email");
    expect(apply).toContain("v_outcome :=");
    expect(apply).not.toContain("p_company_id");
    expect(apply).not.toContain("p_actor_user_id");
    expect(apply).not.toContain("p_sender_email");
    expect(apply).not.toContain("p_outcome");
  });

  it("enforces the Phase C gate without weakening the disabled legacy path", () => {
    const apply = functionBody("public.apply_lead_disposition_feedback");
    const normalized = apply.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "if v_phase_c_enabled then if v_reason not in"
    );
    expect(normalized).toContain(
      "elsif v_reason <> 'legacy_unspecified' then raise exception 'phase_c_disabled'"
    );
    expect(normalized).toContain(
      "if v_opportunity.stage in ('won', 'lost', 'discarded') or v_opportunity.merged_into_opportunity_id is not null then raise exception 'opportunity_terminal_or_merged'"
    );
  });

  it("maps junk to discarded, genuine unsuitable to lost/disqualified, and duplicates to review", () => {
    const apply = functionBody("public.apply_lead_disposition_feedback");
    const normalized = apply.replace(/\s+/g, " ");

    expect(normalized).toContain(
      "when v_reason in ( 'spam', 'job_applicant', 'vendor_sales', 'internal', 'platform_notification', 'test_traffic', 'legacy_unspecified' ) then 'discarded'"
    );
    expect(normalized).toContain("when v_reason = 'not_a_fit' then 'lost'");
    expect(normalized).toContain(
      "when v_reason = 'duplicate' then 'duplicate_review'"
    );
    expect(normalized).toContain(
      "when v_reason = 'other' then 'review_deferred'"
    );
    expect(apply).toContain("'disqualified'");
    expect(apply).toContain("v_target_stage := 'lost'");
    expect(apply).toContain("v_target_stage := 'discarded'");
    expect(apply).toContain("v_target_stage := null");
  });

  it("persists lifecycle, transition, active disposition, and feedback in one function transaction", () => {
    const apply = functionBody("public.apply_lead_disposition_feedback");

    expect(apply).toContain("update public.opportunities");
    expect(apply).toContain("insert into public.stage_transitions");
    expect(apply).toContain("insert into public.opportunity_dispositions");
    expect(apply).toContain("insert into public.lead_disposition_feedback");
    expect(apply).toContain("prior_stage");
    expect(apply).toContain("applied_opportunity_updated_at");
    expect(apply).toContain("disposition_id");
  });

  it("replays the apply receipt before a second lifecycle mutation", () => {
    const apply = functionBody("public.apply_lead_disposition_feedback");
    const receipt = apply.indexOf("apply_idempotency_key = v_idempotency_key");
    const mutation = apply.indexOf("update public.opportunities");

    expect(receipt).toBeGreaterThanOrEqual(0);
    expect(mutation).toBeGreaterThan(receipt);
    expect(apply.slice(receipt, mutation)).toContain("return next");
    expect(apply).toContain("pg_advisory_xact_lock");
    expect(compact).toContain(
      "unique (company_id, actor_user_id, apply_idempotency_key)"
    );
  });

  it("undo retracts learning, restores exact prior lifecycle, and refuses to overwrite later edits", () => {
    const undo = functionBody("public.undo_lead_disposition_feedback");
    const normalized = undo.replace(/\s+/g, " ");

    expect(normalized).toMatch(
      /private\.current_user_can_edit_opportunity\(\s*v_feedback\.opportunity_id\s*\)/
    );
    expect(undo).toContain("for update");
    expect(undo).toContain("applied_opportunity_updated_at");
    expect(undo).toContain("feedback_undo_conflict");
    expect(undo).toContain("prior_stage");
    expect(undo).toContain("prior_lost_reason");
    expect(undo).toContain("prior_lost_notes");
    expect(undo).toContain("prior_actual_close_date");
    expect(undo).toContain("prior_stage_manually_set");
    expect(undo).toContain("insert into public.stage_transitions");
    expect(undo).toContain("set superseded_at = null");
    expect(undo).toContain("learning_state = 'retracted'");
    expect(undo).toContain("retracted_by = v_actor_user_id");
    expect(undo).toContain("undo_idempotency_key = v_idempotency_key");
    expect(undo).toContain("learning_state = 'retracted'");
    expect(undo).toContain("idempotent_replay := true");
  });

  it("returns the authoritative lifecycle receipt needed for safe local apply and Undo", () => {
    for (const fn of [
      "public.apply_lead_disposition_feedback",
      "public.undo_lead_disposition_feedback",
    ]) {
      const body = functionBody(fn);
      for (const field of [
        "current_stage",
        "current_stage_entered_at",
        "current_stage_manually_set",
        "current_lost_reason",
        "current_lost_notes",
        "current_actual_close_date",
        "lifecycle_changed",
        "idempotent_replay",
      ]) {
        expect(body).toContain(field);
      }
    }
  });

  it("keeps context/apply/undo callable through Firebase-bridged roles and all functions locked down", () => {
    for (const fn of [
      "public.get_lead_disposition_context(uuid)",
      "public.apply_lead_disposition_feedback(uuid, text, text, text)",
      "public.undo_lead_disposition_feedback(uuid, text)",
    ]) {
      const flexibleSignature = fn
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/,\\ /g, ",\\s*")
        .replace(/\\\(/g, "\\(\\s*")
        .replace(/\\\)/g, "\\s*\\)");
      expect(compact).toMatch(
        new RegExp(
          `revoke all on function ${flexibleSignature} from public, anon, authenticated, service_role`
        )
      );
      expect(compact).toMatch(
        new RegExp(
          `grant execute on function ${flexibleSignature} to anon, authenticated`
        )
      );
    }
    expect(compact).not.toContain(
      "grant execute on function public.apply_lead_disposition_feedback(uuid, text, text, text) to public"
    );
  });
});
