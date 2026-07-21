import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const lockSource = readFileSync(
  path.join(
    process.cwd(),
    "src/lib/api/services/email-connection-sync-lock.ts"
  ),
  "utf8"
);
const syncSource = readFileSync(
  path.join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);
const historicalImportSource = readFileSync(
  path.join(
    process.cwd(),
    "src/app/api/integrations/gmail/historical-import/route.ts"
  ),
  "utf8"
);

describe("mailbox checkpoint owner fencing", () => {
  it("exposes only dedicated owner-fenced checkpoint helpers", () => {
    expect(lockSource).toContain(
      '"persist_email_connection_recovery_checkpoint_as_system"'
    );
    expect(lockSource).toContain(
      '"persist_email_connection_sync_completion_as_system"'
    );
    expect(lockSource).toContain('"complete_gmail_import_job_as_system"');
    expect(lockSource).toContain("p_owner_id: ownerId");
  });

  it("never publishes a sync cursor through an ordinary connection update", () => {
    expect(syncSource).toContain("persistEmailConnectionRecoveryCheckpoint");
    expect(syncSource).toContain("persistEmailConnectionSyncCompletion");
    expect(syncSource).not.toMatch(
      /EmailService\.updateConnection\(connectionId,\s*\{[\s\S]{0,500}historyId:/
    );
    expect(syncSource).not.toMatch(
      /EmailService\.updateConnection\(connection\.id,\s*\{[\s\S]{0,500}historyRecoveryAnchor:/
    );
  });

  it("publishes historical-import success and cursor through one RPC", () => {
    expect(historicalImportSource).toContain(
      "completeGmailImportJobUnderSyncLock"
    );
    expect(historicalImportSource).not.toMatch(
      /from\("gmail_import_jobs"\)[\s\S]{0,500}status:\s*"completed"/
    );
    expect(historicalImportSource).not.toMatch(
      /from\("email_connections"\)[\s\S]{0,300}history_id:\s*historyBoundary/
    );
    expect(historicalImportSource).toMatch(
      /from\("gmail_import_jobs"\)[\s\S]*?status:\s*"failed"[\s\S]*?\.eq\("id", jobId\)[\s\S]*?\.eq\("status", "running"\)/
    );
  });
});
