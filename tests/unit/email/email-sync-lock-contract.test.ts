import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);

function acquireSyncLockSource(): string {
  const match = source.match(
    /async function acquireSyncLock\([\s\S]*?\n}\n\nasync function renewSyncLock/
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
    expect(acquisition).toContain("p_lease_seconds: SYNC_LOCK_TTL_SECONDS");
    expect(acquisition).not.toContain('.from("email_connections")');
    expect(acquisition).not.toContain(".or(");
    expect(acquisition).not.toContain("crypto.randomUUID()");
  });
});
