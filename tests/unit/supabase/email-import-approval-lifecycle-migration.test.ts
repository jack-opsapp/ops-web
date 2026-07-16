import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260715176000_email_import_approval_lifecycle.sql"
  ),
  "utf8"
).toLowerCase();

describe("email import approval lifecycle migration", () => {
  it("stores one immutable approved import per completed scan", () => {
    expect(sql).toContain("source_scan_job_id uuid");
    expect(sql).toContain("approved_import_payload jsonb");
    expect(sql).toContain("approval_fingerprint text");
    expect(sql).toContain("gmail_scan_jobs_source_import_uidx");
    expect(sql).toMatch(/create unique index[\s\S]*\(source_scan_job_id\)/);
    expect(sql).toContain("guard_email_import_binding");
    expect(sql).toContain("email import binding is immutable");
  });

  it("validates the source job, requester, mailbox, and owner snapshot in the database", () => {
    expect(sql).toContain("source.status <> 'complete'");
    expect(sql).toContain(
      "source.requested_by_user_id is distinct from new.requested_by_user_id"
    );
    expect(sql).toContain(
      "source.connection_owner_user_id is distinct from new.connection_owner_user_id"
    );
    expect(sql).toContain(
      "source.connection_id is distinct from new.connection_id"
    );
    expect(sql).toContain("source.company_id is distinct from new.company_id");
    expect(sql).toContain("email import selected clients are unavailable");
    expect(sql).toContain("client.company_id::text = new.company_id");
  });

  it("uses canonical revoke-safe pipeline helpers and explicit client permissions", () => {
    expect(sql).toContain("coalesce(actor.is_active, false)");
    expect(sql).not.toContain("actor.is_active is distinct from false");
    expect(sql).toContain("private.user_can_create_opportunity");
    expect(sql).toContain("private.effective_pipeline_scope_for_user");
    expect(sql).toContain("'pipeline.edit'");
    expect(sql).toContain("is distinct from 'all'");
    for (const permission of [
      "clients.view",
      "clients.create",
      "clients.edit",
      "clients.delete",
      "settings.integrations",
    ]) {
      expect(sql).toContain(`'${permission}'`);
    }
    expect(sql).not.toMatch(/connection\.email\s*=\s*actor\.email/);
    expect(sql).not.toMatch(/users\.email\s*=\s*connection\.email/);
  });

  it("exposes only service-role prepare, create/resume, and reauthorization RPCs", () => {
    for (const fn of [
      "get_email_import_source_as_system",
      "create_email_import_job_as_system",
      "authorize_email_import_job_as_system",
      "complete_email_import_job_as_system",
      "enqueue_email_import_provider_operation_as_system",
      "authorize_email_import_provider_operation_as_system",
    ]) {
      expect(sql).toContain(`function public.${fn}`);
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${fn}[\\s\\S]*?from public, anon, authenticated, service_role`
        )
      );
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${fn}[\\s\\S]*?to service_role`
        )
      );
    }
    expect(sql).toContain("auth.role() is distinct from 'service_role'");
  });

  it("returns one dispatch winner for duplicate or stale import requests", () => {
    expect(sql).toContain("on conflict (source_scan_job_id)");
    expect(sql).toContain("approval fingerprint conflict");
    expect(sql).toContain("status = 'import_error'");
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toContain("should_dispatch");
  });

  it("persists provider-label operations behind the committed import job", () => {
    expect(sql).toContain(
      "create table if not exists public.email_import_provider_operations"
    );
    expect(sql).toContain(
      "operation_type text not null default 'apply_pipeline_label'"
    );
    expect(sql).toContain(
      "unique (import_job_id, connection_id, provider_thread_id, operation_type)"
    );
    expect(sql).toContain("claim_email_import_provider_operations");
    expect(sql).toContain(
      "authorize_email_import_provider_operation_as_system"
    );
    expect(sql).toContain("complete_email_import_provider_operation");
    expect(sql).toContain("fail_email_import_provider_operation");
    expect(sql).toContain("email_import_provider_operations_incomplete");
    expect(sql).toContain("email_import_provider_thread_not_approved");
    expect(sql).toMatch(
      /complete_email_import_job_as_system[\s\S]*status = 'import_complete'/
    );
  });

  it("reauthorizes the exact current provider-operation lease before mailbox access", () => {
    const authorizationFunction = sql.match(
      /create or replace function public\.authorize_email_import_provider_operation_as_system[\s\S]*?\$function\$;/
    )?.[0];
    expect(authorizationFunction).toBeTruthy();
    expect(authorizationFunction).toContain("operation.status = 'processing'");
    expect(authorizationFunction).toContain("operation.lease_holder = p_holder");
    expect(authorizationFunction).toContain(
      "operation.lease_expires_at > now()"
    );
    expect(authorizationFunction).toContain(
      "identity.owner_user_id is not distinct from job.connection_owner_user_id"
    );
    expect(authorizationFunction).toContain(
      "private.email_import_actor_is_authorized"
    );
  });

  it("reclaims expired processing leases without stranding provider-applied labels", () => {
    expect(sql).toMatch(
      /email_import_provider_operations_claim_idx[\s\S]*?where status in \('pending', 'failed', 'processing'\)/
    );
    expect(sql).toMatch(
      /operation\.status in \('pending', 'failed'\)[\s\S]*?or \(\s*operation\.status = 'processing'[\s\S]*?operation\.lease_expires_at <= now\(\)/
    );
  });

  it("lets only the current holder complete after provider work even if its lease just expired", () => {
    const completionFunction = sql.match(
      /create or replace function public\.complete_email_import_provider_operation[\s\S]*?\$function\$;/
    )?.[0];
    expect(completionFunction).toBeTruthy();
    expect(completionFunction).toContain("status = 'processing'");
    expect(completionFunction).toContain("lease_holder = p_holder");
    expect(completionFunction).not.toContain("lease_expires_at > now()");
    expect(completionFunction).toMatch(
      /status = 'applied'[\s\S]*?provider_label_id is not distinct from[\s\S]*?return true/
    );
  });

  it("prevents application roles from reading or mutating import approval internals", () => {
    expect(sql).toMatch(
      /revoke all on public\.email_import_provider_operations\s+from public, anon, authenticated, service_role/
    );
    expect(sql).not.toMatch(
      /grant\s+(select|insert|update|delete)[\s\S]*?public\.email_import_provider_operations/
    );
    expect(sql).toContain("enqueue_email_import_provider_operation_as_system");
  });
});
