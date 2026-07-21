import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260721127000_data_review_actor_scope.sql"
);

function sql(): string {
  return readFileSync(migrationPath, "utf8");
}

function functionBody(source: string, name: string): string {
  const escaped = name.replaceAll(".", "\\.");
  const match = source.match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+${escaped}\\s*\\([\\s\\S]*?\\)\\s*(?:returns|return)[\\s\\S]*?as\\s+\\$[a-z_]*\\$([\\s\\S]*?)\\$[a-z_]*\\$\\s*;`,
      "i"
    )
  );
  expect(match, `${name} is missing`).toBeTruthy();
  return match![1];
}

describe("data-review actor scope migration", () => {
  it("fails migration closed unless canonical assignment + inbox helpers exist", () => {
    const source = sql();
    for (const signature of [
      "private.user_can_view_opportunity(uuid,uuid)",
      "private.user_can_edit_opportunity(uuid,uuid)",
      "private.user_can_view_opportunity_inbox(uuid,uuid,uuid)",
      "private.lock_lead_assignment_company(uuid)",
    ]) {
      expect(source).toContain(`to_regprocedure('${signature}')`);
    }
    expect(source).toMatch(
      /raise exception 'data_review_actor_scope_prerequisite_missing'/i
    );
  });

  it("keeps one exact-mailbox resolution private and immutable to application roles", () => {
    const source = sql();
    expect(source).toMatch(
      /create table private\.email_thread_data_review_resolutions/i
    );
    expect(source).toMatch(
      /unique\s*\(\s*company_id\s*,\s*connection_id\s*,\s*provider_thread_id\s*\)/i
    );
    expect(source).toMatch(
      /resolution text not null check \(resolution in \('link', 'quarantine'\)\)/i
    );
    expect(source).toMatch(/target_opportunity_id uuid/i);
    expect(source).toMatch(
      /resolution_version bigint not null default 1[\s\S]*?check \(resolution_version >= 1\)/i
    );
    expect(source).toMatch(
      /revoke all on table private\.email_thread_data_review_resolutions[\s\S]*?from public, anon, authenticated, service_role/i
    );
    expect(source).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[\s\S]{0,120}email_thread_data_review_resolutions/i
    );
  });

  it("dedupes versioned data-review outcome notifications for their full lifetime", () => {
    const source = sql();
    const index = source.match(
      /create unique index if not exists notifications_data_review_resolution_v1_unique([\s\S]*?);/i
    )?.[0];

    expect(index).toBeTruthy();
    expect(index).toMatch(
      /on public\.notifications\s*\(\s*user_id\s*,\s*company_id\s*,\s*type\s*,\s*dedupe_key\s*\)/i
    );
    expect(index).toMatch(/type\s*=\s*'data_review_resolved'/i);
    expect(index).toMatch(
      /left\(dedupe_key,\s*length\('data_review_resolution:v1:'\)\)\s*=\s*'data_review_resolution:v1:'/i
    );
    expect(index).not.toMatch(/is_read|resolved_at/i);
  });

  it("derives the current review kind from exact-mailbox database state", () => {
    const body = functionBody(
      sql(),
      "private.current_email_thread_data_review_kind"
    );

    expect(body).toMatch(
      /activity\.company_id\s*=\s*p_company_id[\s\S]*?activity\.email_connection_id\s*=\s*p_connection_id[\s\S]*?activity\.email_thread_id\s*=\s*p_provider_thread_id/i
    );
    expect(body).toMatch(
      /count\s*\(\s*distinct\s+activity\.opportunity_id\s*\)/i
    );
    expect(body).toMatch(/v_activity_owner_count\s*>\s*1/i);
    expect(body).toMatch(
      /thread\.company_id\s*=\s*p_company_id[\s\S]*?thread\.connection_id\s*=\s*p_connection_id[\s\S]*?thread\.provider_thread_id\s*=\s*p_provider_thread_id[\s\S]*?thread\.opportunity_id\s+is\s+null/i
    );
    expect(body).toMatch(
      /link\.connection_id\s*=\s*p_connection_id[\s\S]*?link\.thread_id\s*=\s*p_provider_thread_id/i
    );
    expect(body).toMatch(
      /opportunity\.stage\s+in\s*\(\s*'won'\s*,\s*'lost'\s*,\s*'discarded'\s*\)/i
    );
    expect(body).toMatch(/opportunity\.archived_at\s+is\s+null/i);
    expect(body).toMatch(/opportunity\.deleted_at\s+is\s+null/i);
  });

  it("authorizes reads only for the authenticated OPS actor's company and every exact lead owner", () => {
    const body = functionBody(sql(), "private.user_can_review_email_thread");
    expect(body).toMatch(
      /from public\.users[\s\S]*?id\s*=\s*p_actor_user_id[\s\S]*?company_id\s*=\s*p_company_id[\s\S]*?deleted_at is null/i
    );
    expect(body).toMatch(
      /company\.id::text\s*=\s*connection\.company_id[\s\S]*?connection\.id\s*=\s*p_connection_id[\s\S]*?company\.id\s*=\s*p_company_id/i
    );
    expect(body).toMatch(
      /thread\.connection_id\s*=\s*p_connection_id[\s\S]*?thread\.provider_thread_id\s*=\s*p_provider_thread_id/i
    );
    expect(body).toMatch(
      /activity\.email_connection_id\s*=\s*p_connection_id[\s\S]*?activity\.email_thread_id\s*=\s*p_provider_thread_id/i
    );
    expect(body).not.toMatch(/email_connection_id\s+is\s+null/i);
    expect(body).toContain("private.user_can_view_opportunity(");
    expect(body).toContain("private.user_can_view_opportunity_inbox(");
    expect(body).toContain("private.user_can_edit_opportunity(");
    expect(body).toMatch(/bool_and/i);
  });

  it("keeps a quarantined retry scoped to its durable exact-mailbox owners", () => {
    const body = functionBody(sql(), "private.user_can_review_email_thread");

    expect(body).toMatch(
      /activity\.email_thread_id\s*=\s*'legacy:'\s*\|\|\s*p_provider_thread_id/i
    );
    expect(body).toMatch(
      /email_thread_data_review_resolutions[\s\S]*?resolution\.company_id\s*=\s*p_company_id[\s\S]*?resolution\.connection_id\s*=\s*p_connection_id[\s\S]*?resolution\.provider_thread_id\s*=\s*p_provider_thread_id[\s\S]*?resolution\.resolution\s*=\s*'quarantine'/i
    );
  });

  it("exposes one service-only read bridge with no caller-selected email identity", () => {
    const source = sql();
    const body = functionBody(
      source,
      "public.authorize_email_thread_data_review_as_system"
    );
    expect(body).toMatch(/auth\.role\(\)[\s\S]*?'service_role'/i);
    expect(body).toContain("private.current_email_thread_data_review_kind(");
    expect(body).toMatch(
      /v_actual_kind\s+is\s+distinct\s+from\s+p_kind[\s\S]*?return false/i
    );
    expect(body).toContain("private.user_can_review_email_thread(");
    expect(body).not.toMatch(/email\s*=|connection\.email|users\.email/i);
    expect(source).toMatch(
      /revoke all on function public\.authorize_email_thread_data_review_as_system\([\s\S]*?from public, anon, authenticated, service_role/i
    );
    expect(source).toMatch(
      /grant execute on function public\.authorize_email_thread_data_review_as_system\([\s\S]*?to service_role/i
    );
  });

  it("replaces the legacy five-argument mutation transport with actor-aware exact-mailbox RPCs", () => {
    const source = sql();
    expect(source).toMatch(
      /revoke all on function public\.reassign_opportunity_email_thread_guarded\(\s*uuid,\s*uuid,\s*text,\s*uuid,\s*text\s*\)[\s\S]*?from public, anon, authenticated, service_role/i
    );

    for (const name of [
      "public.reassign_opportunity_email_thread_guarded",
      "public.quarantine_opportunity_email_thread_guarded",
    ]) {
      const body = functionBody(source, name);
      expect(body, name).toMatch(/auth\.role\(\)[\s\S]*?'service_role'/i);
      expect(body, name).toContain("private.lock_lead_assignment_company(");
      expect(body, name).toContain("private.user_can_review_email_thread(");
      expect(body, name).toMatch(
        /email_threads[\s\S]*?company_id\s*=\s*p_company_id[\s\S]*?connection_id\s*=\s*p_connection_id[\s\S]*?provider_thread_id\s*=\s*p_provider_thread_id[\s\S]*?for update/i
      );
      expect(body, name).not.toMatch(/email_connection_id\s+is\s+null/i);
      expect(source).toMatch(
        new RegExp(
          `revoke all on function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?from public, anon, authenticated, service_role`,
          "i"
        )
      );
      expect(source).toMatch(
        new RegExp(
          `grant execute on function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?to service_role`,
          "i"
        )
      );
    }

    // Mailbox-scoped provider ids may legitimately collide in another mailbox.
    expect(source).not.toMatch(
      /count\s*\(\s*distinct\s+thread\.connection_id\s*\)|more than one mailbox connection/i
    );
  });

  it("authorizes under locks before any reassignment/quarantine write", () => {
    const source = sql();
    const linkBody = functionBody(
      source,
      "public.reassign_opportunity_email_thread_guarded"
    );
    const quarantineBody = functionBody(
      source,
      "public.quarantine_opportunity_email_thread_guarded"
    );

    for (const body of [linkBody, quarantineBody]) {
      const companyLock = body.indexOf("private.lock_lead_assignment_company(");
      const exactThreadLock = body.indexOf(
        "private.lock_email_thread_data_review("
      );
      const firstKindDerivation = body.indexOf(
        "private.current_email_thread_data_review_kind("
      );
      expect(companyLock).toBeGreaterThan(-1);
      expect(exactThreadLock).toBeGreaterThan(companyLock);
      expect(firstKindDerivation).toBeGreaterThan(exactThreadLock);
      expect(
        body.match(/private\.current_email_thread_data_review_kind\(/g)
      ).toHaveLength(2);
      expect(
        body.lastIndexOf("private.current_email_thread_data_review_kind(")
      ).toBeGreaterThan(body.indexOf("order by opportunity.id"));
      expect(body).toMatch(
        /v_actual_kind\s+is\s+distinct\s+from\s+p_kind[\s\S]*?data_review_access_denied/i
      );
    }

    const linkAuth = linkBody.indexOf("private.user_can_review_email_thread(");
    expect(linkAuth).toBeGreaterThan(-1);
    expect(linkAuth).toBeLessThan(
      linkBody.indexOf("exact mailbox thread not found")
    );
    for (const mutation of [
      "update public.opportunity_email_threads",
      "update public.email_threads",
      "update public.activities",
    ]) {
      expect(linkBody.indexOf(mutation), mutation).toBeGreaterThan(linkAuth);
    }

    const quarantineAuth = quarantineBody.indexOf(
      "private.user_can_review_email_thread("
    );
    expect(quarantineAuth).toBeGreaterThan(-1);
    expect(quarantineAuth).toBeLessThan(
      quarantineBody.indexOf("exact mailbox thread not found")
    );
    expect(quarantineBody.indexOf("update public.activities")).toBeGreaterThan(
      quarantineAuth
    );
    expect(
      quarantineBody.indexOf(
        "insert into private.email_thread_data_review_resolutions"
      )
    ).toBeGreaterThan(quarantineAuth);
  });

  it("allows only a proven same-kind link retry after the anomaly is already resolved", () => {
    const body = functionBody(
      sql(),
      "public.reassign_opportunity_email_thread_guarded"
    );

    expect(body).toMatch(
      /v_existing_resolution\.resolution\s*=\s*'link'[\s\S]*?v_existing_resolution\.kind\s*=\s*p_kind[\s\S]*?v_existing_resolution\.target_opportunity_id\s*=\s*p_target_opportunity_id/i
    );
    expect(body).toContain("private.email_thread_data_review_link_is_aligned(");
    expect(body).toMatch(
      /'activities_repointed'\s*,\s*v_existing_resolution\.activities_repointed[\s\S]*?'email_threads_repointed'\s*,\s*v_existing_resolution\.email_threads_repointed[\s\S]*?'opportunity_email_threads_repointed'\s*,\s*v_existing_resolution\.opportunity_email_threads_repointed[\s\S]*?'already_resolved'\s*,\s*true/i
    );
    expect(body).toMatch(
      /insert into private\.email_thread_data_review_resolutions[\s\S]*?activities_repointed[\s\S]*?email_threads_repointed[\s\S]*?opportunity_email_threads_repointed[\s\S]*?'link'/i
    );
    expect(body).toMatch(
      /resolution_version\s*=\s*resolution\.resolution_version\s*\+\s*1[\s\S]*?returning resolution\.resolution_version\s+into v_resolution_version/i
    );
    expect(body).toMatch(
      /'resolution_version'\s*,\s*v_(?:existing_resolution\.resolution_version|resolution_version)/i
    );
  });

  it("allows terminal cache alignment only to the server-derived canonical link owner", () => {
    const body = functionBody(
      sql(),
      "public.reassign_opportunity_email_thread_guarded"
    );

    expect(body).toMatch(
      /if p_kind\s*=\s*'terminal_live'[\s\S]*?v_link_owner_id\s+is\s+distinct\s+from\s+p_target_opportunity_id[\s\S]*?raise exception 'target opportunity is not the canonical mailbox-thread owner'/i
    );
  });

  it("serializes quarantine with future activity inserts and converges retries cumulatively", () => {
    const source = sql();
    const lockBody = functionBody(
      source,
      "private.lock_email_thread_data_review"
    );
    const triggerBody = functionBody(
      source,
      "private.apply_email_thread_data_review_quarantine"
    );
    const quarantineBody = functionBody(
      source,
      "public.quarantine_opportunity_email_thread_guarded"
    );

    expect(lockBody).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(lockBody).toContain("p_company_id::text");
    expect(lockBody).toContain("p_connection_id::text");
    expect(lockBody).toContain("p_provider_thread_id");

    expect(quarantineBody).toContain("private.lock_email_thread_data_review(");
    const existingResolutionBranch = quarantineBody.match(
      /if v_has_resolution\s*\n\s+and v_existing_resolution\.resolution\s*=\s*'quarantine' then([\s\S]*?)end if;/i
    )?.[1];
    expect(existingResolutionBranch).toBeTruthy();
    expect(existingResolutionBranch).toMatch(
      /update public\.activities[\s\S]*?email_connection_id\s*=\s*p_connection_id[\s\S]*?email_thread_id\s*=\s*p_provider_thread_id/i
    );
    expect(existingResolutionBranch).toMatch(
      /update private\.email_thread_data_review_resolutions[\s\S]*?activities_quarantined\s*=\s*resolution\.activities_quarantined\s*\+\s*v_activities_quarantined/i
    );

    expect(triggerBody).toMatch(
      /new\.company_id[\s\S]*?new\.email_connection_id[\s\S]*?new\.email_thread_id/i
    );
    expect(triggerBody).toContain("private.lock_email_thread_data_review(");
    expect(triggerBody).toMatch(
      /resolution\.company_id\s*=\s*new\.company_id[\s\S]*?resolution\.connection_id\s*=\s*new\.email_connection_id[\s\S]*?resolution\.provider_thread_id\s*=\s*v_provider_thread_id/i
    );
    expect(triggerBody).toMatch(
      /new\.email_thread_id\s*:=\s*'legacy:'\s*\|\|\s*v_provider_thread_id/i
    );
    expect(triggerBody).toMatch(
      /new\.email_connection_id\s+is\s+null[\s\S]*?return new;/i
    );
    expect(source).toMatch(
      /create trigger activities_apply_data_review_quarantine_on_insert\s+before insert on public\.activities\s+for each row execute function private\.apply_email_thread_data_review_quarantine\(\)/i
    );
  });

  it("converges a later null-to-exact mailbox claim into the durable quarantine exactly once", () => {
    const source = sql();
    const body = functionBody(
      source,
      "private.converge_email_thread_data_review_quarantine_after_claim"
    );

    expect(body).toContain("private.lock_email_thread_data_review(");
    expect(body).toMatch(
      /new\.company_id[\s\S]*?new\.email_connection_id[\s\S]*?new\.email_thread_id/i
    );
    expect(body).toMatch(
      /resolution\.company_id\s*=\s*new\.company_id[\s\S]*?resolution\.connection_id\s*=\s*new\.email_connection_id[\s\S]*?resolution\.provider_thread_id\s*=\s*v_provider_thread_id[\s\S]*?resolution\.resolution\s*=\s*'quarantine'/i
    );
    expect(body).toMatch(
      /update public\.activities activity\s+set email_thread_id\s*=\s*'legacy:'\s*\|\|\s*v_provider_thread_id[\s\S]*?activity\.id\s*=\s*new\.id[\s\S]*?activity\.email_connection_id\s*=\s*new\.email_connection_id[\s\S]*?activity\.email_thread_id\s*=\s*v_provider_thread_id/i
    );
    expect(body).toMatch(/get diagnostics v_rewritten = row_count/i);
    expect(body).toMatch(
      /activities_quarantined\s*=\s*resolution\.activities_quarantined\s*\+\s*v_rewritten/i
    );
    expect(source).toMatch(
      /create trigger activities_data_review_quarantine_after_claim\s+after update of email_connection_id on public\.activities\s+for each row\s+when\s*\(\s*old\.email_connection_id is null\s+and\s+new\.email_connection_id is not null\s*\)\s+execute function private\.converge_email_thread_data_review_quarantine_after_claim\(\)/i
    );

    // The nested convergence update changes only email_thread_id, so this
    // email_connection_id-only trigger cannot recurse or double-count itself.
    expect(source).not.toMatch(
      /create trigger activities_data_review_quarantine_after_claim\s+after update of[\s\S]{0,100}email_thread_id/i
    );
  });

  it("counts only quarantined activity rows that were actually inserted", () => {
    const source = sql();
    const beforeInsertBody = functionBody(
      source,
      "private.apply_email_thread_data_review_quarantine"
    );
    const afterInsertBody = functionBody(
      source,
      "private.record_email_thread_data_review_quarantine"
    );

    expect(beforeInsertBody).not.toMatch(
      /activities_quarantined\s*=\s*resolution\.activities_quarantined\s*\+\s*1/i
    );
    expect(afterInsertBody).toMatch(
      /new\.email_thread_id\s*=\s*'legacy:'\s*\|\|\s*resolution\.provider_thread_id/i
    );
    expect(afterInsertBody).toMatch(
      /resolution\.company_id\s*=\s*new\.company_id[\s\S]*?resolution\.connection_id\s*=\s*new\.email_connection_id/i
    );
    expect(afterInsertBody).toMatch(
      /activities_quarantined\s*=\s*resolution\.activities_quarantined\s*\+\s*1/i
    );
    expect(source).toMatch(
      /create trigger activities_record_data_review_quarantine_after_insert\s+after insert on public\.activities\s+for each row execute function private\.record_email_thread_data_review_quarantine\(\)/i
    );
  });

  it("serializes guarded opportunity merges before their opportunity-first lock path", () => {
    const source = sql();
    const body = functionBody(
      source,
      "public.execute_opportunity_merge_guarded"
    );

    expect(source).toMatch(
      /alter function public\.execute_opportunity_merge_guarded\([\s\S]*?\) rename to execute_opportunity_merge_guarded_review_serialized_inner/i
    );
    expect(body).toMatch(/auth\.role\(\)[\s\S]*?'service_role'/i);
    const companyLock = body.indexOf("private.lock_lead_assignment_company(");
    const innerCall = body.indexOf(
      "public.execute_opportunity_merge_guarded_review_serialized_inner("
    );
    expect(companyLock).toBeGreaterThan(-1);
    expect(innerCall).toBeGreaterThan(companyLock);
    expect(source).toMatch(
      /revoke all on function public\.execute_opportunity_merge_guarded_review_serialized_inner\([\s\S]*?from public, anon, authenticated, service_role/i
    );
  });
});
