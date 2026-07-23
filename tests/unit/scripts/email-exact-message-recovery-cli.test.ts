import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  authorizeEmailExactMessageIngest,
  authorizeEmailExactMessageRecovery,
  parseEmailExactMessageRecoveryCliArgs,
  requireExactRecoveryCorrespondenceEvent,
} from "../../../scripts/recover-email-exact-messages";
import * as recoveryCli from "../../../scripts/recover-email-exact-messages";

const scriptPath = join(
  process.cwd(),
  "scripts/recover-email-exact-messages.ts"
);

type RecoveryReactServerGuard = (
  execArgv?: string[],
  nodeOptions?: string
) => void;

function recoveryReactServerGuard(): RecoveryReactServerGuard | undefined {
  return (
    recoveryCli as typeof recoveryCli & {
      requireEmailExactMessageRecoveryReactServerRuntime?: RecoveryReactServerGuard;
    }
  ).requireEmailExactMessageRecoveryReactServerRuntime;
}

describe("exact-message recovery CLI", () => {
  it("is dry-run by default", () => {
    expect(
      parseEmailExactMessageRecoveryCliArgs([
        "--manifest",
        "/tmp/exact-recovery.json",
      ])
    ).toEqual({
      manifestPath: "/tmp/exact-recovery.json",
      apply: false,
      approvedManifestSha256: null,
      supersedePriorManifestPath: null,
      supersedeProviderMessageIds: [],
      json: false,
    });
  });

  it("requires content-addressed approval for apply", () => {
    expect(() =>
      parseEmailExactMessageRecoveryCliArgs([
        "--manifest",
        "/tmp/exact-recovery.json",
        "--apply",
      ])
    ).toThrow("--apply requires --approve-manifest-sha256");

    expect(
      parseEmailExactMessageRecoveryCliArgs([
        "--manifest",
        "/tmp/exact-recovery.json",
        "--apply",
        "--approve-manifest-sha256",
        "a".repeat(64),
      ])
    ).toMatchObject({
      apply: true,
      approvedManifestSha256: "a".repeat(64),
    });
  });

  it("rejects broad selectors and malformed approvals", () => {
    expect(() => parseEmailExactMessageRecoveryCliArgs([])).toThrow(
      "--manifest is required"
    );
    expect(() =>
      parseEmailExactMessageRecoveryCliArgs([
        "--manifest",
        "/tmp/exact-recovery.json",
        "--since",
        "7 days",
      ])
    ).toThrow("Unknown argument: --since");
    expect(() =>
      parseEmailExactMessageRecoveryCliArgs([
        "--manifest",
        "/tmp/exact-recovery.json",
        "--apply",
        "--approve-manifest-sha256",
        "not-a-sha",
      ])
    ).toThrow("must be 64 lowercase hexadecimal characters");
    expect(() =>
      parseEmailExactMessageRecoveryCliArgs([
        "--manifest",
        "/tmp/exact-recovery.json",
        "--now",
        "2026-07-22T18:30:00.000Z",
      ])
    ).toThrow("Unknown argument: --now");
  });

  it("requires an explicit prior manifest and exact message list for reviewed supersession", () => {
    expect(() =>
      parseEmailExactMessageRecoveryCliArgs([
        "--manifest",
        "/tmp/new.json",
        "--supersede-prior-manifest",
        "/tmp/prior.json",
        "--supersede-provider-message-id",
        "message-b",
      ])
    ).toThrow("reviewed supersession requires --apply");
    expect(() =>
      parseEmailExactMessageRecoveryCliArgs([
        "--manifest",
        "/tmp/new.json",
        "--apply",
        "--approve-manifest-sha256",
        "a".repeat(64),
        "--supersede-prior-manifest",
        "/tmp/prior.json",
      ])
    ).toThrow("requires both --supersede-prior-manifest");

    expect(
      parseEmailExactMessageRecoveryCliArgs([
        "--manifest",
        "/tmp/new.json",
        "--apply",
        "--approve-manifest-sha256",
        "a".repeat(64),
        "--supersede-prior-manifest",
        "/tmp/prior.json",
        "--supersede-provider-message-id",
        "message-b",
      ])
    ).toMatchObject({
      supersedePriorManifestPath: "/tmp/prior.json",
      supersedeProviderMessageIds: ["message-b"],
    });
    expect(() =>
      parseEmailExactMessageRecoveryCliArgs([
        "--manifest",
        "/tmp/new.json",
        "--apply",
        "--approve-manifest-sha256",
        "a".repeat(64),
        "--supersede-prior-manifest",
        "/tmp/prior.json",
        "--supersede-provider-message-id",
        "message-a",
        "--supersede-provider-message-id",
        "message-b",
      ])
    ).toThrow("exactly one provider message per invocation");
  });

  it("contains no provider-write or cursor-movement calls", () => {
    const source = readFileSync(
      join(process.cwd(), "scripts/recover-email-exact-messages.ts"),
      "utf8"
    );

    for (const forbidden of [
      ".applyLabel(",
      ".removeLabel(",
      ".createLabel(",
      ".createDraft(",
      ".createNewThreadDraft(",
      ".updateDraft(",
      ".archiveThread(",
      ".sendEmail(",
      "history_id:",
      "last_synced_at:",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain("fetchThread:");
    expect(source).toContain("authorize_email_inbox_action_as_system");
    expect(source.indexOf("authorizeEmailExactMessageRecovery({")).toBeLessThan(
      source.indexOf("fetchThread:")
    );
    expect(source).toContain("repairExactReparentedMessageForRecovery");
    expect(source).toContain("supersedeUnstartedEmailExactMessageRecoveryWork");
    expect(source).toContain("repairReparentedMessage:");
    expect(source).toContain('entry.action === "create_target_and_reparent"');
    expect(source).toContain("repairExactReparentedMessage");
  });

  it("requires and documents the react-server condition before server-only imports", () => {
    const source = readFileSync(scriptPath, "utf8");
    const guard = recoveryReactServerGuard();

    expect(guard).toBeTypeOf("function");
    expect(() => guard?.(["--import", "tsx"], undefined)).toThrow(
      "node --conditions=react-server --import tsx"
    );
    expect(() =>
      guard?.(["--conditions=react-server", "--import", "tsx"], undefined)
    ).not.toThrow();
    expect(source).toContain("node --conditions=react-server --import tsx");
    expect(
      source.indexOf("requireEmailExactMessageRecoveryReactServerRuntime();")
    ).toBeLessThan(
      source.indexOf('import("../src/lib/api/services/email-service")')
    );
  });

  it("fails at the runtime guard before touching a manifest or server-only dependency", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        scriptPath,
        "--manifest",
        "/tmp/exact-recovery-runtime-guard.json",
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "node --conditions=react-server --import tsx"
    );
    expect(result.stderr).not.toContain("ENOENT");
    expect(result.stderr).not.toContain("server-only");
  });

  it("fails closed when canonical mailbox-view authorization denies the actor", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));

    await expect(
      authorizeEmailExactMessageRecovery({
        client: { rpc },
        actorUserId: "10000000-0000-4000-8000-000000000002",
        connectionId: "10000000-0000-4000-8000-000000000003",
      })
    ).rejects.toThrow("Actor cannot view this recovery mailbox");

    expect(rpc).toHaveBeenCalledWith("authorize_email_inbox_action_as_system", {
      p_actor_user_id: "10000000-0000-4000-8000-000000000002",
      p_connection_id: "10000000-0000-4000-8000-000000000003",
      p_opportunity_id: null,
      p_action: "view",
    });
  });

  it("requires canonical mailbox plus pipeline create/edit authority before exact ingest", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));

    await expect(
      authorizeEmailExactMessageIngest({
        client: { rpc },
        actorUserId: "10000000-0000-4000-8000-000000000002",
        companyId: "10000000-0000-4000-8000-000000000001",
        connectionId: "10000000-0000-4000-8000-000000000003",
      })
    ).rejects.toThrow("Actor cannot ingest exact recovery messages");

    expect(rpc).toHaveBeenCalledWith(
      "authorize_email_exact_message_ingest_as_system",
      {
        p_actor_user_id: "10000000-0000-4000-8000-000000000002",
        p_company_id: "10000000-0000-4000-8000-000000000001",
        p_connection_id: "10000000-0000-4000-8000-000000000003",
      }
    );
  });

  it("resolves only one exact target-owned projected meaningful customer inbound event", async () => {
    const row = {
      id: "10000000-0000-4000-8000-000000000007",
      company_id: "10000000-0000-4000-8000-000000000001",
      opportunity_id: "10000000-0000-4000-8000-000000000005",
      connection_id: "10000000-0000-4000-8000-000000000003",
      activity_id: "10000000-0000-4000-8000-000000000006",
      provider_thread_id: "thread-victoria-forward",
      provider_message_id: "message-victoria-forward",
      direction: "inbound",
      party_role: "customer",
      is_meaningful: true,
      opportunity_projection_applied: true,
    };
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      limit: vi.fn(async () => ({ data: [row], error: null })),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const from = vi.fn(() => query);

    await expect(
      requireExactRecoveryCorrespondenceEvent({
        client: { from },
        companyId: row.company_id,
        opportunityId: row.opportunity_id,
        connectionId: row.connection_id,
        activityId: row.activity_id,
        providerThreadId: row.provider_thread_id,
        providerMessageId: row.provider_message_id,
        expectedEventId: row.id,
      })
    ).resolves.toBe(row.id);

    expect(from).toHaveBeenCalledWith("opportunity_correspondence_events");
    expect(query.eq).toHaveBeenCalledWith("direction", "inbound");
    expect(query.eq).toHaveBeenCalledWith("party_role", "customer");
    expect(query.eq).toHaveBeenCalledWith("is_meaningful", true);
    expect(query.eq).toHaveBeenCalledWith(
      "opportunity_projection_applied",
      true
    );
    expect(query.limit).toHaveBeenCalledWith(2);
  });

  it("rejects a non-unique recovery projection event", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      limit: vi.fn(async () => ({
        data: [{ id: "one" }, { id: "two" }],
        error: null,
      })),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);

    await expect(
      requireExactRecoveryCorrespondenceEvent({
        client: { from: () => query },
        companyId: "10000000-0000-4000-8000-000000000001",
        opportunityId: "10000000-0000-4000-8000-000000000005",
        connectionId: "10000000-0000-4000-8000-000000000003",
        activityId: "10000000-0000-4000-8000-000000000006",
        providerThreadId: "thread-victoria-forward",
        providerMessageId: "message-victoria-forward",
        expectedEventId: null,
      })
    ).rejects.toThrow("not found uniquely");
  });
});
