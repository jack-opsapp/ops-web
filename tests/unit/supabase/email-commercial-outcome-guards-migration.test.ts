import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = path.join(process.cwd(), "supabase", "migrations");
const rollbackContract = readFileSync(
  path.join(process.cwd(), "tests", "sql", "lead-assignment-contract.sql"),
  "utf8"
);
const migrations = readdirSync(migrationsDirectory)
  .filter((filename) => filename.endsWith(".sql"))
  .sort()
  .map((filename) => ({
    filename,
    sql: readFileSync(path.join(migrationsDirectory, filename), "utf8"),
  }));

function latestFunction(marker: string) {
  const definition = migrations
    .filter(({ sql }) => sql.toLowerCase().includes(marker.toLowerCase()))
    .at(-1);
  if (!definition) throw new Error(`Missing migration definition: ${marker}`);
  const start = definition.sql.toLowerCase().lastIndexOf(marker.toLowerCase());
  const end = definition.sql.indexOf("$function$;", start);
  if (end < 0) throw new Error(`Unterminated function definition: ${marker}`);
  return {
    ...definition,
    body: definition.sql.slice(start, end + "$function$;".length),
    tail: definition.sql.slice(end + "$function$;".length),
  };
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").toLowerCase();
}

describe("email commercial-outcome database guards", () => {
  it("uses an email-only conservative street identity without changing the global normalizer", () => {
    const definition = latestFunction(
      "create or replace function private.normalize_email_project_dedupe_address"
    );
    const body = compact(definition.body);
    const tail = compact(definition.tail);

    expect(body).toContain("private.normalize_address(p_address)");
    expect(body).toContain("street_type_ordinality");
    expect(body).toContain("unit_identifier");
    expect(body).toContain("(apartment|suite|unit|ste|apt|#)");
    expect(body).toMatch(/' unit ' \|\| unit_identity\.unit_identifier/);
    expect(body).toContain("normalized.value ~ '^[0-9]+[a-z]?");
    expect(body).toMatch(
      /tokens\.ordinality <= boundary\.street_type_ordinality/
    );
    expect(body).toMatch(/'street'[\s\S]*?'road'[\s\S]*?'boulevard'/);
    expect(tail).toContain("123 example st");
    expect(tail).toContain("123 example street, example city bc");
    expect(tail).toMatch(
      /normalize_email_project_dedupe_address\('123 example st'\)[\s\S]*?is distinct from[\s\S]*?normalize_email_project_dedupe_address/
    );
    expect(tail).toMatch(
      /normalize_email_project_dedupe_address\([\s\S]*?123 example st, apartment 2, example city bc[\s\S]*?is distinct from[\s\S]*?normalize_email_project_dedupe_address\('123 example street unit 2'\)/
    );
    expect(tail).toMatch(
      /normalize_email_project_dedupe_address\('123 example street unit 2'\)[\s\S]*?is not distinct from[\s\S]*?normalize_email_project_dedupe_address\('123 example st #3'\)/
    );
  });

  it("serializes every active project identity mutation without blocking behind a held row lock", () => {
    const definition = latestFunction(
      "create or replace function private.serialize_project_email_identity_change"
    );
    const body = compact(definition.body);
    const tail = compact(definition.tail);
    const migration = compact(
      migrations.find(({ filename }) => filename.startsWith("20260721143000"))
        ?.sql ?? ""
    );

    expect(migration).not.toContain("allow_active_identity_overlap");
    expect(migration).not.toContain("insert can wait");
    expect(migration).not.toContain(
      "email_active_project_identity_reservations"
    );
    expect(body).toContain("pg_try_advisory_xact_lock");
    expect(body).toContain("tg_op <> 'insert'");
    expect(body).toContain("tg_op = 'insert'");
    expect(body).toContain("old.company_id, old.client_id");
    expect(body).toContain("new.company_id, new.client_id");
    expect(body).toContain("email_project_identity_busy");
    expect(body).toContain("errcode = '40001'");
    expect(tail).toMatch(
      /create trigger projects_serialize_email_identity_change[\s\S]*?before insert or delete or update of[\s\S]*?opportunity_ref/
    );
    const rollback = compact(rollbackContract);
    expect(rollback).not.toContain("disable trigger");

    const conversion = latestFunction(
      "create or replace function public.convert_opportunity_to_project"
    );
    const conversionBody = compact(conversion.body);
    expect(conversionBody).toMatch(
      /if v_link_to_project_id is not null then[\s\S]*?target\.client_id = v_initial_client_id[\s\S]*?normalize_email_project_dedupe_address\(target\.address\)/
    );
    expect(conversionBody).toContain("pg_try_advisory_xact_lock");
    expect(conversionBody).toContain("email_project_identity_busy");
  });

  it("coalesces one-sided opportunity client mirrors and rejects disagreement", () => {
    const definition = latestFunction(
      "create or replace function private.resolve_opportunity_client_id"
    );
    const body = compact(definition.body);

    expect(body).toContain("p_client_ref is not null");
    expect(body).toContain("p_client_id is not null");
    expect(body).toContain("p_client_ref is distinct from p_client_id");
    expect(body).toContain("opportunity_client_mirrors_disagree");
    expect(body).toContain("return coalesce(p_client_ref, p_client_id)");
    expect(compact(definition.tail)).toMatch(
      /revoke all on function private\.resolve_opportunity_client_id\(uuid, uuid\)[\s\S]*?service_role/
    );
  });

  it("requires a persisted customer sender instead of trusting party-role classification", () => {
    const definition = latestFunction(
      "create or replace function private.opportunity_sender_is_persisted_customer"
    );
    const body = compact(definition.body);
    const tail = compact(definition.tail);

    expect(body).toContain("security definer");
    expect(body).toContain("lower(btrim(coalesce(p_from_email, '')))");
    expect(body).toContain("opportunity.contact_email");
    expect(body).toContain("public.clients owning_client");
    expect(body).toMatch(
      /owning_client\.id = private\.resolve_opportunity_client_id\([\s\S]*?opportunity\.client_ref[\s\S]*?opportunity\.client_id/
    );
    expect(body).toContain("owning_client.email");
    expect(body).toContain("public.sub_clients alternate_contact");
    expect(body).toMatch(
      /alternate_contact\.client_id = private\.resolve_opportunity_client_id\([\s\S]*?opportunity\.client_ref[\s\S]*?opportunity\.client_id/
    );
    expect(body).toContain("alternate_contact.deleted_at is null");
    expect(body).toContain("alternate_contact.email");
    expect(tail).toMatch(
      /revoke all on function private\.opportunity_sender_is_persisted_customer[\s\S]*?service_role/
    );
  });

  it("detects every meaningful event still waiting for opportunity projection", () => {
    const definition = latestFunction(
      "create or replace function private.opportunity_has_pending_meaningful_email"
    );
    const body = compact(definition.body);

    expect(body).toContain("public.opportunity_correspondence_events event");
    expect(body).toContain("event.company_id = p_company_id");
    expect(body).toContain("event.opportunity_id = p_opportunity_id");
    expect(body).toContain("event.is_meaningful is true");
    expect(body).toContain("event.opportunity_projection_applied is false");
    expect(compact(definition.tail)).toMatch(
      /revoke all on function private\.opportunity_has_pending_meaningful_email[\s\S]*?service_role/
    );
  });

  it("applies a fresh explicit budget/timing deferral atomically and idempotently", () => {
    const definition = latestFunction(
      "create or replace function public.apply_email_opportunity_deferred_disposition"
    );
    const body = compact(definition.body);

    expect(body).toContain("auth.role()");
    expect(body).toContain("service_role");
    expect(body).toContain("for update");
    expect(body).toContain("stage_manually_set");
    expect(body).toContain("assignment_version");
    expect(body).toContain("p_expected_stage");
    expect(body).toContain("evaluated_through_event_id");
    expect(body).toContain("opportunity_has_pending_meaningful_email");
    expect(body).toContain("meaningful correspondence projection pending");
    expect(body).toMatch(
      /newer\.occurred_at > v_evaluated_through_at[\s\S]*?raise exception 'deferred disposition evidence is stale'/
    );
    expect(body).toMatch(
      /opportunity_correspondence_events event[\s\S]*?event\.direction = 'inbound'[\s\S]*?event\.party_role = 'customer'[\s\S]*?opportunity_sender_is_persisted_customer\([\s\S]*?event\.from_email[\s\S]*?event\.is_meaningful is true/
    );
    expect(body).toMatch(
      /update public\.opportunities[\s\S]*?set stage = 'lost'[\s\S]*?lost_reason = 'budget_timing'[\s\S]*?next_follow_up_at = v_effective_follow_up_at/
    );
    expect(body).toContain("insert into public.stage_transitions");
    expect(body).toMatch(
      /insert into public\.opportunity_dispositions[\s\S]*?'lost'[\s\S]*?'budget_timing'[\s\S]*?'guarded_lifecycle'/
    );
    expect(body).toContain("already_applied");
    expect(body).toContain("v_decisive_occurred_at");
    expect(body).toMatch(
      /v_max_follow_up_at := \( \(v_decisive_occurred_at at time zone 'utc'\) \+ interval '18 months' \) at time zone 'utc'/
    );
    expect(body).toMatch(
      /v_effective_follow_up_at := least\( p_next_follow_up_at, v_max_follow_up_at \)/
    );
    expect(body).not.toContain(
      "p_next_follow_up_at > now() + interval '18 months'"
    );
    expect(body).toMatch(
      /jsonb_build_object\([\s\S]*?'next_follow_up_at', v_effective_follow_up_at[\s\S]*?'requested_next_follow_up_at', p_next_follow_up_at/
    );
    expect(body).toContain("next_follow_up_at = v_effective_follow_up_at");
    expect(body).toMatch(
      /return query select[\s\S]*?'lost'::text,[\s\S]*?v_effective_follow_up_at/
    );
    expect(body).toMatch(
      /v_existing_connection_id is not distinct from p_connection_id[\s\S]*?v_existing_provider_message_id is not distinct from p_provider_message_id[\s\S]*?'already_applied'/
    );
    expect(body).not.toContain("retry_payload_mismatch");
    expect(body).toMatch(
      /v_is_redeferral := v_opp\.stage = 'lost'[\s\S]*?if v_is_redeferral then[\s\S]*?next_follow_up_at = v_effective_follow_up_at/
    );
    const reDeferralBranch = body.match(
      /if v_is_redeferral then([\s\S]*?)else([\s\S]*?)end if;/
    );
    expect(reDeferralBranch?.[1]).not.toContain(
      "insert into public.stage_transitions"
    );
    expect(reDeferralBranch?.[2]).toContain(
      "insert into public.stage_transitions"
    );
    const opportunityUpdate = body.match(
      /update public\.opportunities[\s\S]*?where id = p_opportunity_id/
    )?.[0];
    expect(opportunityUpdate).toBeDefined();
    expect(opportunityUpdate).not.toMatch(/assigned_to\s*=/);

    const assignmentGuard = body.indexOf(
      "if v_opp.assignment_version is distinct from p_expected_assignment_version"
    );
    const manualGuard = body.indexOf(
      "if coalesce(v_opp.stage_manually_set, false)"
    );
    const exactRetry = body.indexOf(
      "v_existing_provider_message_id is not distinct from p_provider_message_id"
    );
    const staleEvidence = body.indexOf(
      "raise exception 'deferred disposition evidence is stale'"
    );
    const stageSnapshot = body.indexOf(
      "if v_opp.stage is distinct from p_expected_stage"
    );
    const pendingProjection = body.indexOf(
      "if private.opportunity_has_pending_meaningful_email"
    );
    const highWaterLookup = body.indexOf("select head.occurred_at");
    expect(pendingProjection).toBeGreaterThan(-1);
    expect(highWaterLookup).toBeGreaterThan(pendingProjection);
    expect(assignmentGuard).toBeGreaterThan(-1);
    expect(manualGuard).toBeGreaterThan(assignmentGuard);
    expect(exactRetry).toBeGreaterThan(manualGuard);
    expect(staleEvidence).toBeGreaterThan(exactRetry);
    expect(stageSnapshot).toBeGreaterThan(staleEvidence);
    expect(compact(definition.tail)).toMatch(
      /revoke all on function public\.apply_email_opportunity_deferred_disposition[\s\S]*?grant execute[\s\S]*?to service_role/
    );
  });

  it("binds email acceptance to one trusted decisive event and a fresh opportunity high-water mark", () => {
    const definition = latestFunction(
      "create or replace function private.valid_actorless_opportunity_conversion_evidence"
    );
    const body = compact(definition.body);

    expect(body).toContain("decisive_event_id");
    expect(body).toContain("evaluated_through_event_id");
    expect(body).toContain("event.provider_message_id");
    expect(body).toContain("event.opportunity_projection_applied is true");
    expect(body).toMatch(
      /event\.direction = 'inbound'[\s\S]*?event\.party_role = 'customer'[\s\S]*?opportunity_sender_is_persisted_customer\([\s\S]*?event\.from_email/
    );
    expect(body).toMatch(
      /event\.direction = 'outbound'[\s\S]*?event\.party_role = 'ops'[\s\S]*?explicit_acceptance/
    );
    expect(body).toMatch(
      /newer\.occurred_at > v_evaluated_through_at[\s\S]*?return false/
    );
    expect(body).toMatch(
      /opportunity_conversion_events conversion_event[\s\S]*?conversion_event\.event_type = 'converted_to_project'[\s\S]*?v_conversion_completed/
    );
    expect(body).toMatch(
      /opportunity_sender_is_persisted_customer\([\s\S]*?event\.from_email[\s\S]*?not \(p_evidence -> 'signals' \? 'signed_estimate'\)[\s\S]*?attachment\.message_id = event\.provider_message_id[\s\S]*?attachment\.provider_thread_id = thread\.provider_thread_id[\s\S]*?attachment\.opportunity_id = p_opportunity_id[\s\S]*?attachment\.attribution_status = 'attributed'/
    );
    expect(body).toMatch(
      /inspection\.email_attachment_id = attachment\.id[\s\S]*?inspection\.company_id = attachment\.company_id[\s\S]*?inspection\.connection_id = attachment\.connection_id[\s\S]*?inspection\.message_id = attachment\.message_id[\s\S]*?inspection\.attachment_id = attachment\.attachment_id[\s\S]*?inspection\.is_signed_estimate is true/
    );
    expect(body).not.toContain("p_source_path = 'email_likely_won'");
    expect(compact(definition.tail)).toMatch(
      /revoke all on function private\.valid_actorless_opportunity_conversion_evidence[\s\S]*?service_role/
    );
  });

  it("deduplicates actorless conversion across every active project before any canonical write", () => {
    const definition = latestFunction(
      "create or replace function public.convert_opportunity_to_project"
    );
    const body = compact(definition.body);

    expect(body).toContain(
      "private.valid_actorless_opportunity_conversion_evidence"
    );
    expect(body).toMatch(/p_source_path <> 'email_accept'/);
    expect(body).toContain("pg_try_advisory_xact_lock");
    expect(body).toContain("private.email_project_dedupe_lock_key");
    expect(body).toContain(
      "private.normalize_email_project_dedupe_address(target.address)"
    );
    expect(body).toContain(
      "private.normalize_email_project_dedupe_address(v_opp.address)"
    );
    expect(body).not.toContain("target.opportunity_ref is null");
    expect(body).not.toContain("target.opportunity_id is null");
    expect(body).toContain("matching_project_link_conflict");
    expect(body).toContain("project_link_ambiguous");
    expect(body).toContain("dedupe_proof_unavailable");
    expect(body).toMatch(
      /v_initial_client_id := private\.resolve_opportunity_client_id\([\s\S]*?v_opp\.client_ref[\s\S]*?v_opp\.client_id/
    );
    expect(body).toMatch(
      /private\.resolve_opportunity_client_id\([\s\S]*?v_opp\.client_ref[\s\S]*?v_opp\.client_id[\s\S]*?is distinct from v_initial_client_id/
    );
    expect(body).toMatch(
      /set client_ref = v_initial_client_id,[\s\S]*?client_id = v_initial_client_id[\s\S]*?execute_opportunity_conversion_core/
    );
    expect(body).toContain("opportunity_has_pending_meaningful_email");
    expect(body).toContain("meaningful correspondence projection pending");
    expect(body).toMatch(
      /nullif\(v_initial_normalized_address, ''\) is null[\s\S]*?target\.client_id = v_initial_client_id[\s\S]*?for update[\s\S]*?v_candidate_count > 0[\s\S]*?dedupe_proof_unavailable/
    );
    expect(body).toMatch(
      /target\.client_id = v_initial_client_id[\s\S]*?normalize_email_project_dedupe_address\(target\.address\)[\s\S]*?for update[\s\S]*?v_candidate_has_conflicting_link[\s\S]*?v_candidate_count > 1/
    );
    expect(body).toContain("v_link_to_project_id");
    expect(body).toContain("v_initial_project_id");
    expect(body).toMatch(
      /v_target\.opportunity_ref is not null[\s\S]*?v_target\.opportunity_ref is distinct from p_opportunity_id/
    );
    expect(body).toMatch(
      /try_parse_uuid\(v_target\.opportunity_id::text\) is not null[\s\S]*?is distinct from p_opportunity_id/
    );
    expect(body).toContain("v_existing_conversion_complete");
    expect(body).toContain("v_exact_completed_retry");
    expect(body).toMatch(
      /opportunity_conversion_events event[\s\S]*?opportunity_dispositions disposition[\s\S]*?v_existing_conversion_complete := found/
    );
    expect(body).toMatch(
      /v_opp\.stage = 'lost'[\s\S]*?lost_reason = null[\s\S]*?lost_notes = null[\s\S]*?next_follow_up_at = null/
    );
    expect(body).toMatch(
      /p_evidence ->> 'decisive_direction' = 'inbound'[\s\S]*?p_evidence -> 'signals' \? 'payment_confirmed'/
    );
    expect(body).toMatch(
      /v_initial_project_id is not null[\s\S]*?not v_existing_conversion_complete[\s\S]*?'converted', true[\s\S]*?'already_converted', false/
    );

    const projectLock = body.indexOf("from public.projects target");
    const lockedOpportunity = body.lastIndexOf("from public.opportunities o");
    const pendingProjectionGuard = body.indexOf(
      "and private.opportunity_has_pending_meaningful_email"
    );
    const evidenceRevalidation = body.indexOf(
      "and not private.valid_actorless_opportunity_conversion_evidence"
    );
    expect(projectLock).toBeGreaterThan(-1);
    expect(lockedOpportunity).toBeGreaterThan(projectLock);
    expect(pendingProjectionGuard).toBeGreaterThan(lockedOpportunity);
    expect(evidenceRevalidation).toBeGreaterThan(pendingProjectionGuard);
    const assignmentGuard = body.indexOf("assignment_snapshot_mismatch");
    const manualGuard = body.indexOf("manual_stage_override");
    const stageGuard = body.indexOf("if p_expected_stage is not null");
    const terminalGuard = body.indexOf(
      "v_opp.stage in ('won', 'lost', 'discarded')"
    );
    const canonicalRepair = body.indexOf(
      "v_result := private.execute_opportunity_conversion_core"
    );
    const idempotentReturn = body.indexOf("'already_converted', true");
    expect(manualGuard).toBeGreaterThan(assignmentGuard);
    expect(stageGuard).toBeGreaterThan(manualGuard);
    expect(terminalGuard).toBeGreaterThan(stageGuard);
    expect(canonicalRepair).toBeGreaterThan(terminalGuard);
    expect(idempotentReturn).toBeGreaterThan(canonicalRepair);
    expect(body).not.toMatch(/assigned_to\s*=/);
  });

  it("covers client_ref-only conversion and mirror disagreement in the rollback contract", () => {
    const contract = compact(rollbackContract);

    expect(contract).toContain("actorless_client_ref_only_conversion");
    expect(contract).toContain("actorless_client_mirror_disagreement_denied");
    expect(contract).toContain("opportunity_client_mirrors_disagree");
    expect(contract).toMatch(
      /actorless_client_ref_only_conversion[\s\S]*?project\.client_id = '1ead5519-0000-4000-8000-000000000404'/
    );
  });

  it("covers a clamped 24-month re-deferral and an exact retry in the rollback contract", () => {
    const contract = compact(rollbackContract);

    expect(contract).toContain("deferred_redeferral_24_month_retry");
    expect(contract).toMatch(
      /deferred_redeferral[\s\S]*?p_next_follow_up_at => now\(\) \+ interval '24 months'/
    );
    expect(contract).toMatch(
      /redeferral\.value ->> 'next_follow_up_at'\)::timestamptz = \([\s\S]*?event\.occurred_at at time zone 'utc'[\s\S]*?interval '18 months'/
    );
    expect(contract).toMatch(
      /redeferral_retry\.value ->> 'guard_reason' = 'already_applied'[\s\S]*?redeferral_retry\.value ->> 'next_follow_up_at' =[\s\S]*?redeferral\.value ->> 'next_follow_up_at'/
    );
  });
});
