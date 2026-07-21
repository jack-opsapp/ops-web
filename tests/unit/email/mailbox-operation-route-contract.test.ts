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
    "src/app/api/inbox/name-backfill/route.ts",
    "src/app/api/inbox/reclassify/route.ts",
    "src/app/api/inbox/backfill/route.ts",
  ])("uses the central connection-operation helper in %s", (path) => {
    expect(source(path)).toContain("email-connection-operation-access");
  });

  it.each([
    "src/app/api/integrations/email/auto-send/settings/route.ts",
    "src/app/api/integrations/email/draft-stats-by-category/route.ts",
    "src/app/api/integrations/email/draft-stats/route.ts",
  ])("uses exact actor Phase C mailbox authorization in %s", (path) => {
    const route = source(path);
    expect(route).toContain("phase-c-category-settings-access");
    expect(route).toContain("resolvePhaseCCategorySettingsAccess");
  });

  it.each([
    "src/app/api/integrations/gmail/labels/route.ts",
    "src/app/api/integrations/gmail/scan-preview/route.ts",
    "src/app/api/integrations/gmail/scan-start/route.ts",
    "src/app/api/integrations/gmail/historical-import/route.ts",
  ])(
    "authorizes the canonical mailbox owner and rejects non-Gmail connections before provider access in %s",
    (path) => {
      const route = source(path);
      expect(route).toContain("resolveEmailConnectionOperationAccess");
      expect(route).toMatch(/provider\s*!==\s*["']gmail["']/);
    }
  );

  it.each([
    "src/app/api/integrations/gmail/scan-status/route.ts",
    "src/app/api/integrations/gmail/import-status/route.ts",
    "src/app/api/integrations/gmail/import-history/route.ts",
    "src/app/api/integrations/gmail/block-domain/route.ts",
  ])(
    "derives exact mailbox access and proves the Gmail provider in %s",
    (path) => {
      const route = source(path);
      expect(route).toContain("email-connection-operation-access");
      expect(route).toMatch(/provider\s*!==\s*["']gmail["']/);
    }
  );

  it("filters Gmail import history to the canonical actor's authorized connection ids", () => {
    const route = source(
      "src/app/api/integrations/gmail/import-history/route.ts"
    );
    expect(route).toContain('in("connection_id", gmailConnectionIds)');
  });

  it("filters Gmail review items through the canonical inbox and lead intersection", () => {
    const route = source(
      "src/app/api/integrations/gmail/review-items/route.ts"
    );
    expect(route).toContain("resolveEmailInboxListAccess");
    expect(route).toContain("buildEmailThreadListAuthorizationFilter");
    expect(route).toContain("email_connection_id");
    expect(route).toContain("opportunity_id");
    expect(route).toContain('eq("provider", "gmail")');
  });

  it.each([
    "src/app/api/integrations/gmail/confirm-match/route.ts",
    "src/app/api/integrations/gmail/reject-match/route.ts",
    "src/app/api/integrations/gmail/ignore/route.ts",
  ])(
    "derives the exact activity connection and intersects canonical thread access in %s",
    (path) => {
      const route = source(path);
      expect(route).toContain("email_connection_id");
      expect(route).toContain("email_thread_id");
      expect(route).toContain("resolveEmailOpportunityAccess");
      expect(route).toMatch(/provider\s*!==\s*["']gmail["']/);
    }
  );

  it("limits Gmail domain blocking to the selected mailbox", () => {
    const route = source(
      "src/app/api/integrations/gmail/block-domain/route.ts"
    );
    expect(route).toMatch(
      /from\(["']activities["']\)[\s\S]*?update\([\s\S]*?eq\(["']email_connection_id["'],\s*connectionId\)/
    );
    expect(route).toContain("resolveEmailInboxListAccess");
    expect(route).toContain("buildEmailThreadListAuthorizationFilter");
  });

  it("derives mailbox draft statistics from the authenticated actor and exact connection", () => {
    const route = source("src/app/api/integrations/email/draft-stats/route.ts");
    expect(route).toContain("connectionId");
    expect(route).toContain("access.actor.userId");
    expect(route).toMatch(
      /AIDraftService\.getApprovalStats\(\s*companyId,\s*connectionId,\s*access\.actor\.userId\s*\)/
    );
    expect(route).not.toContain('searchParams.get("userId")');
  });

  it("binds auto-send settings acceptance to the authenticated OPS actor", () => {
    const route = source(
      "src/app/api/integrations/email/auto-send/settings/route.ts"
    );
    expect(route).toMatch(
      /AutoSendService\.updateSettings\(\s*companyId,\s*connectionId,\s*access\.actor\.userId,\s*settings\s*\)/
    );
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

  it.each([
    "src/app/api/cron/webhook-renewal/route.ts",
    "src/app/api/inbox/phase-c-backfill/route.ts",
    "src/app/api/inbox/threads/[id]/route.ts",
    "src/app/api/integrations/email/activate/route.ts",
    "src/app/api/integrations/email/inbox/route.ts",
    "src/app/api/integrations/gmail/labels/route.ts",
  ])(
    "serializes direct provider access through the mailbox lease in %s",
    (path) => {
      expect(source(path)).toContain("runWithEmailConnectionSyncLock");
    }
  );

  it.each([
    "src/app/api/inbox/drafts/route.ts",
    "src/app/api/integrations/email/draft/route.ts",
  ])(
    "routes provider draft operations through the reusable mailbox fence in %s",
    (path) => {
      expect(source(path)).toContain("runEmailProviderMailboxOperation");
    }
  );

  it.each([
    "src/app/api/integrations/gmail/scan-preview/route.ts",
    "src/app/api/integrations/gmail/scan-start/route.ts",
  ])(
    "owns and releases the mailbox lease around bounded Gmail scans in %s",
    (path) => {
      const route = source(path);
      expect(route).toContain("acquireEmailConnectionSyncLock");
      expect(route).toContain("releaseEmailConnectionSyncLock");
    }
  );

  it.each([
    "src/app/api/inbox/backfill/route.ts",
    "src/app/api/integrations/email/analyze-continue/route.ts",
    "src/app/api/integrations/email/analyze-memory/route.ts",
    "src/app/api/integrations/gmail/historical-import/route.ts",
    "src/app/api/integrations/ai-setup/email-scan/route.ts",
  ])(
    "keeps long-running provider work under a renewable mailbox lease in %s",
    (path) => {
      const route = source(path);
      expect(route).toContain("acquireEmailConnectionSyncLock");
      expect(route).toContain("createEmailConnectionSyncLockRenewer");
    }
  );

  it.each([
    "src/lib/api/services/ai-sync-reviewer.ts",
    "src/lib/api/services/draft-reconciliation.ts",
    "src/lib/api/services/email-attachments/attachment-runtime.ts",
    "src/lib/api/services/email-signature-service.ts",
    "src/lib/api/services/mailbox-draft-push.ts",
    "src/lib/api/services/pattern-detection-service.ts",
    "src/lib/api/services/phase-c-autonomy-router.ts",
  ])("makes reusable provider operations self-fencing in %s", (path) => {
    const service = source(path);
    expect(service).toContain("runEmailProviderMailboxOperation");
    expect(service).toContain("providerLockCheckpoint");
  });

  it("self-acquires the mailbox fence for standalone thread provider actions", () => {
    const service = source("src/lib/api/services/email-thread-service.ts");
    expect(service).toContain("runEmailProviderMailboxOperation");
    expect(service).toContain("runThreadProviderOperation");
  });

  it("checks mailbox ownership on both sides of analysis provider batches", () => {
    const phaseB = source(
      "src/app/api/integrations/email/analyze-continue/route.ts"
    );
    const phaseC = source(
      "src/app/api/integrations/email/analyze-memory/route.ts"
    );

    expect(phaseB).toMatch(
      /await providerLockCheckpoint\(\);[\s\S]{0,8000}const results = await Promise\.all\([\s\S]{0,8000}await providerLockCheckpoint\(\);/
    );
    expect(phaseC).toMatch(
      /await proveMailboxOwnership\(\);[\s\S]{0,8000}const results = await Promise\.all\([\s\S]{0,8000}await proveMailboxOwnership\(\);/
    );
  });
});
