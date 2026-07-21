import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(
    process.cwd(),
    "src/lib/api/services/email-connection-sync-lock.ts"
  ),
  "utf8"
);

function acquireSyncLockSource(): string {
  const match = source.match(
    /export async function acquireEmailConnectionSyncLock\([\s\S]*?\n}\n\nexport async function renewEmailConnectionSyncLock/
  );
  return match?.[0] ?? "";
}

describe("email sync lock acquisition contract", () => {
  it("uses the atomic database RPC instead of a PostgREST OR-filtered update", () => {
    const acquisition = acquireSyncLockSource();

    expect(acquisition).toMatch(
      /\.rpc\(\s*"acquire_email_connection_sync_lock_as_system"/
    );
    expect(acquisition).toContain("p_connection_id: connectionId");
    expect(acquisition).toContain(
      "p_lease_seconds: EMAIL_CONNECTION_SYNC_LOCK_TTL_SECONDS"
    );
    expect(acquisition).not.toContain('.from("email_connections")');
    expect(acquisition).not.toContain(".or(");
    expect(acquisition).not.toContain("crypto.randomUUID()");
  });

  it("renews and releases through the global owner-fenced RPCs", () => {
    expect(source).toContain(
      '.rpc(\n    "renew_email_connection_sync_lock_as_system"'
    );
    expect(source).toContain(
      '.rpc(\n      "release_email_connection_sync_lock_as_system"'
    );
    expect(source).toContain(
      "p_lease_seconds: EMAIL_CONNECTION_SYNC_LOCK_TTL_SECONDS"
    );
    expect(source).toContain("p_owner_id: ownerId");
    expect(source).not.toContain('.from("email_connections")');
  });
});
