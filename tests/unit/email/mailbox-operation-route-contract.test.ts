import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("mailbox operation route authorization contract", () => {
  it.each([
    "src/app/api/integrations/email/manual-sync/route.ts",
    "src/app/api/integrations/gmail/manual-sync/route.ts",
    "src/app/api/integrations/email/analyze/route.ts",
    "src/app/api/integrations/email/activate/route.ts",
    "src/app/api/integrations/email/auto-send/settings/route.ts",
    "src/app/api/inbox/name-backfill/route.ts",
    "src/app/api/inbox/reclassify/route.ts",
    "src/app/api/inbox/backfill/route.ts",
    "src/app/api/integrations/email/draft-stats-by-category/route.ts",
  ])("uses the central connection-operation helper in %s", (path) => {
    expect(source(path)).toContain("email-connection-operation-access");
  });

  it("applies the canonical inbox root authorization filter to velocity", () => {
    const route = source("src/app/api/inbox/velocity/route.ts");
    expect(route).toContain("resolveEmailInboxListAccess");
    expect(route).toContain("buildEmailThreadListAuthorizationFilter");
    expect(route).toContain(
      "type.eq.company,and(type.eq.individual,user_id.eq.${userId})"
    );
    expect(route).not.toContain("user_id.is.null");
    expect(route).not.toContain("inbox.view_company");
  });

  it("treats every company mailbox as shared regardless of legacy connector metadata", () => {
    const route = source("src/app/api/inbox/threads/route.ts");
    expect(route).toContain(
      "type.eq.company,and(type.eq.individual,user_id.eq.${userId})"
    );
    expect(route).not.toContain("user_id.is.null");
  });

  it.each([
    "src/app/api/integrations/email/analyze-continue/route.ts",
    "src/app/api/integrations/email/analyze-memory/route.ts",
    "src/app/api/integrations/email/analyze-memory-continue/route.ts",
  ])("rechecks the persisted requester before continuation in %s", (path) => {
    expect(source(path)).toContain("authorizeEmailAnalysisJobContinuation");
  });

  it("polls analysis status through the requester fence and current mailbox access", () => {
    const route = source(
      "src/app/api/integrations/email/analyze-status/route.ts"
    );
    expect(route).toContain("authorizeEmailAnalysisJobContinuation");
    expect(route).toContain("authorizeEmailConnectionOperationForActor");
  });

  it("persists the canonical requester and owner snapshot when analysis starts", () => {
    const route = source("src/app/api/integrations/email/analyze/route.ts");
    expect(route).toContain("requested_by_user_id: access.actor.userId");
    expect(route).toContain("connection_owner_user_id: connectionOwnerUserId");
    expect(route).toContain("emailConnectionOwnerId(connectionAccess)");
  });

  it("attributes analysis completion to the immutable requester, never a connector user", () => {
    const route = source(
      "src/app/api/integrations/email/analyze-continue/route.ts"
    );
    expect(route).toContain("completionAccess.actorUserId");
    expect(route).toContain("completionAccess.companyId");
    expect(route).not.toContain("currentConn.user_id");
    expect(route).not.toContain("currentConn?.user_id");
  });

  it("rechecks Phase B before provider batches and atomically publishes the final result", () => {
    const route = source(
      "src/app/api/integrations/email/analyze-continue/route.ts"
    );
    expect(route).toContain("requireCurrentAnalysisAccess");
    expect(route).toContain(
      'await requireCurrentAnalysisAccess("provider_batch")'
    );
    expect(route).toMatch(/\.rpc\(\s*"complete_email_analysis_job_as_system"/);
    expect(route).not.toContain('.select("sync_filters")');
  });

  it("attributes Phase C state to the persisted requester, not the mailbox owner", () => {
    const entry = source(
      "src/app/api/integrations/email/analyze-memory/route.ts"
    );
    const continuation = source(
      "src/app/api/integrations/email/analyze-memory-continue/route.ts"
    );
    expect(entry).toContain("backgroundAccess.actorUserId");
    expect(entry).toContain("const userId = actorUserId");
    expect(entry).not.toContain("const userId = connection.userId");
    expect(continuation).toContain("state.userId !== actorUserId");
  });

  it("resolves activation signature setup for the authenticated OPS actor", () => {
    const route = source("src/app/api/integrations/email/activate/route.ts");
    expect(route).toContain("userId: access.actor.userId");
    expect(route).not.toContain("userId: connection.userId");
  });
});
