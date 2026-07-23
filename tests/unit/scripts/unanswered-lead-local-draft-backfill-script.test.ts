import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  parseUnansweredLeadLocalDraftCliArgs,
  requireUnansweredLeadReactServerRuntime,
} from "../../../scripts/backfill-unanswered-lead-local-drafts";

const scriptPath = path.join(
  process.cwd(),
  "scripts/backfill-unanswered-lead-local-drafts.ts"
);

function scriptSource(): string {
  return readFileSync(scriptPath, "utf8");
}

describe("unanswered-lead local-draft backfill CLI", () => {
  it("keeps snapshot planning offline and manifest execution dry-run by default", () => {
    const source = scriptSource();

    expect(source).toContain("--snapshot");
    expect(source).toContain("--manifest");
    expect(source).toContain("selectUnansweredLeadDraftCandidates");
    expect(source).toContain("previousSevenVancouverCalendarDays");
    expect(source).toContain("runApprovedUnansweredLeadLocalDraftBackfill");
    expect(
      parseUnansweredLeadLocalDraftCliArgs([
        "--manifest",
        "/tmp/approved-drafts.json",
      ])
    ).toEqual({
      snapshotPath: null,
      manifestPath: "/tmp/approved-drafts.json",
      apply: false,
      approvedManifestSha256: null,
      outputPath: null,
      now: null,
      json: false,
    });
  });

  it("requires an exact manifest hash for apply and rejects broad selectors", () => {
    expect(() =>
      parseUnansweredLeadLocalDraftCliArgs([
        "--manifest",
        "/tmp/approved-drafts.json",
        "--apply",
      ])
    ).toThrow("--apply requires --approve-manifest-sha256");

    expect(
      parseUnansweredLeadLocalDraftCliArgs([
        "--manifest",
        "/tmp/approved-drafts.json",
        "--apply",
        "--approve-manifest-sha256",
        "a".repeat(64),
      ])
    ).toMatchObject({
      apply: true,
      approvedManifestSha256: "a".repeat(64),
    });

    expect(() =>
      parseUnansweredLeadLocalDraftCliArgs([
        "--manifest",
        "/tmp/approved-drafts.json",
        "--since",
        "7 days",
      ])
    ).toThrow("Unknown argument: --since");
    expect(() =>
      parseUnansweredLeadLocalDraftCliArgs([
        "--snapshot",
        "/tmp/snapshot.json",
        "--apply",
        "--approve-manifest-sha256",
        "a".repeat(64),
      ])
    ).toThrow("--apply requires --manifest");
  });

  it("requires the react-server Node condition before loading live server-only dependencies", () => {
    expect(() =>
      requireUnansweredLeadReactServerRuntime(["--import", "tsx"])
    ).toThrow("node --conditions=react-server --import tsx");
    expect(() =>
      requireUnansweredLeadReactServerRuntime([
        "--conditions=react-server",
        "--import",
        "tsx",
      ])
    ).not.toThrow();
  });

  it("runs directly under Node with the explicit react-server condition", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "ops-unanswered-draft-smoke-")
    );
    const snapshotPath = path.join(directory, "snapshot.json");
    writeFileSync(
      snapshotPath,
      JSON.stringify({
        companyId: "company-smoke",
        capturedAt: "2026-07-22T17:30:00.000Z",
        opportunities: [],
      })
    );
    try {
      const result = spawnSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          scriptPath,
          "--snapshot",
          snapshotPath,
          "--now",
          "2026-07-22T17:30:00.000Z",
          "--json",
        ],
        { cwd: process.cwd(), encoding: "utf8" }
      );

      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        mode: "dry-run",
        safety: {
          liveReads: false,
          liveWrites: false,
          mailboxWrites: false,
          copyGeneration: false,
        },
        candidates: [],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("contains no Gmail, provider-draft, send, label, archive, or model operation", () => {
    const source = scriptSource();

    expect(source).not.toContain("EmailService");
    expect(source).not.toMatch(/\.applyLabel\s*\(/);
    expect(source).not.toMatch(/\.createDraft\s*\(/);
    expect(source).not.toMatch(/\.createNewThreadDraft\s*\(/);
    expect(source).not.toMatch(/\.updateDraft\s*\(/);
    expect(source).not.toMatch(/\.sendEmail\s*\(/);
    expect(source).not.toMatch(/\.applyLabel\s*\(/);
    expect(source).not.toMatch(/\.archiveThread\s*\(/);
    expect(source).not.toContain("EmailService");
  });

  it("emits identifiers and reasons without printing untrusted email bodies", () => {
    const source = scriptSource();

    expect(source).toContain("sourceProviderMessageId");
    expect(source).toContain("sourceEventId");
    expect(source).toContain("excluded");
    expect(source).not.toMatch(/untrustedBodyText\s*:/);
    expect(source).not.toMatch(/console\.(log|error)\([^\n]*body/i);
  });
});
