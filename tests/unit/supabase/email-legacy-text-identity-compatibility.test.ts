import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function migration(name: string): string {
  return readFileSync(
    resolve(process.cwd(), `supabase/migrations/${name}`),
    "utf8"
  ).toLowerCase();
}

const sendIntents = migration("20260715162000_email_send_intents.sql");
const phaseCQueue = migration("20260715163000_phase_c_auto_send_queue.sql");
const personalMailbox = migration(
  "20260715164000_personal_mailbox_disable_lifecycle.sql"
);
const approvedActions = migration(
  "20260715171000_approved_action_email_transport.sql"
);
const analysisFence = migration(
  "20260715174000_email_analysis_requester_fence.sql"
);
const interactions = migration(
  "20260715175000_email_interaction_atomic_writes.sql"
);
const importLifecycle = migration(
  "20260715176000_email_import_approval_lifecycle.sql"
);
const compactAnalysisFence = analysisFence.replace(/\s+/g, " ");

describe("legacy email TEXT identity compatibility", () => {
  it("compares legacy TEXT feature-override companies to canonical UUID text", () => {
    expect(sendIntents).toContain("afo.company_id = v_intent.company_id::text");
    expect(phaseCQueue).toContain("afo.company_id = p_company_id::text");
    expect(phaseCQueue).toContain("afo.company_id = v_queue.company_id::text");
    expect(approvedActions).toContain(
      "f.company_id = v_intent.company_id::text"
    );
  });

  it("resolves mailbox identity through canonical company and user UUID rows", () => {
    expect(analysisFence).toContain(
      "create or replace function private.resolve_email_connection_identity"
    );
    expect(analysisFence).toContain("company.id::text = connection.company_id");
    expect(analysisFence).toContain("connection.type::text = 'individual'");
    expect(analysisFence).toContain("owner.id::text = connection.user_id");
    expect(analysisFence).toContain("owner.company_id = company.id");
    expect(analysisFence).toContain("owner.deleted_at is null");
    expect(analysisFence).toContain("coalesce(owner.is_active, false)");
    expect(compactAnalysisFence).toContain(
      "case when connection.type::text = 'individual' then owner.id else null::uuid end"
    );
    expect(compactAnalysisFence).toContain(
      "connection.type::text <> 'individual' or owner.id is not null"
    );
    expect(analysisFence).not.toContain(
      "set connection_owner_user_id = connection.user_id"
    );
    expect(analysisFence).not.toContain("select connection.user_id");
  });

  it("keeps company-mailbox owner snapshots null despite a legacy connector user", () => {
    expect(analysisFence).toContain(
      "set connection_owner_user_id = identity.owner_user_id"
    );
    expect(analysisFence).toContain(
      "from private.resolve_email_connection_identity"
    );
    expect(analysisFence).toContain(
      "new.connection_owner_user_id := v_owner_user_id"
    );

    expect(importLifecycle).toContain(
      "private.resolve_email_connection_identity"
    );
    expect(importLifecycle).toContain(
      "source_job.connection_owner_user_id is not distinct from v_connection_owner_user_id"
    );
    expect(importLifecycle).toContain(
      "'connectionowneruserid', v_connection_owner_user_id"
    );
    expect(importLifecycle).not.toMatch(
      /'connectionowneruserid',\s*connection\.user_id/
    );
  });

  it("casts legacy mailbox company and owner text at every UUID authorization boundary", () => {
    expect(importLifecycle).toContain(
      "connection.company_id = p_company_id::text"
    );
    expect(importLifecycle).toContain(
      "v_connection.user_id is distinct from p_actor_user_id::text"
    );
    expect(importLifecycle).toContain(
      "connection.company_id = operation.company_id::text"
    );
    expect(importLifecycle).toContain(
      "identity.owner_user_id is not distinct from job.connection_owner_user_id"
    );
    expect(importLifecycle).not.toMatch(
      /connection\.company_id\s*=\s*p_company_id(?!::text)/
    );
    expect(importLifecycle).not.toMatch(
      /v_connection\.user_id\s+is distinct from\s+p_actor_user_id(?!::text)/
    );
    expect(importLifecycle).not.toMatch(
      /mailbox\.user_id\s+is not distinct from\s*(source|import_job)\.connection_owner_user_id/
    );
  });

  it("writes canonical UUID values only to UUID import-operation columns", () => {
    expect(importLifecycle).toContain("v_company_id uuid");
    expect(importLifecycle).toMatch(
      /insert into public\.email_import_provider_operations[\s\S]*?values \(\s*import_job\.id,\s*v_company_id,/
    );
    expect(importLifecycle).not.toMatch(
      /insert into public\.email_import_provider_operations[\s\S]*?values \(\s*import_job\.id,\s*connection\.company_id,/
    );
  });

  it("uses explicit text forms for remaining legacy text storage", () => {
    expect(personalMailbox).not.toContain("v_connection.company_id::uuid");
    expect(personalMailbox).toContain(
      "company.id::text = v_connection.company_id"
    );
    expect(interactions).toMatch(
      /insert into public\.agent_memories[\s\S]*?v_thread\.company_id,\s*p_actor_user_id::text,/
    );
  });
});
