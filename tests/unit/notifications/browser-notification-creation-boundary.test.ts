import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry) ? [path] : [];
  });
}

function matchingSource(pattern: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => relative(ROOT, path));
}

describe("browser notification creation boundary", () => {
  it("has no product call site for the retired generic creation hook", () => {
    expect(matchingSource(/\buseCreateNotification\b/)).toEqual([]);
  });

  it("does not ship a Gmail sync-count notification poller", () => {
    const dashboard = readFileSync(
      join(ROOT, "src/components/layouts/dashboard-layout.tsx"),
      "utf8"
    );
    const barrel = readFileSync(join(ROOT, "src/lib/hooks/index.ts"), "utf8");

    expect(
      existsSync(join(ROOT, "src/lib/hooks/use-gmail-sync-notifications.ts"))
    ).toBe(false);
    expect(dashboard).not.toContain("useGmailSyncNotifications");
    expect(dashboard).not.toContain("GmailSyncNotifier");
    expect(barrel).not.toContain("useGmailSyncNotifications");
  });

  it("keeps browser hooks away from the generic notification RPC", () => {
    const browserDirectories = [
      join(SRC, "components"),
      join(SRC, "hooks"),
      join(SRC, "lib/hooks"),
    ];
    const browserSources = browserDirectories.flatMap(sourceFiles);
    const offenders = browserSources
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return (
          source.includes("create_notification_if_new") ||
          source.includes("NotificationService.create")
        );
      })
      .map((path) => relative(ROOT, path));

    expect(offenders).toEqual([]);
  });

  it("mounts one bodyless setup-prompt sync instead of trusting browser state or copy", () => {
    const source = readFileSync(
      join(ROOT, "src/hooks/useActionPrompts.ts"),
      "utf8"
    );

    expect(source).toContain('authedFetch("/api/notifications/setup-prompts"');
    expect(source).toContain('method: "POST"');
    expect(source).not.toMatch(/\bbody\s*:/);
    expect(source).not.toMatch(
      /useAuthStore|usePermissionStore|useTeamMembers|useGmailConnections/
    );
    expect(source).not.toMatch(
      /Connect Gmail|Invite your team|recipientUserIds|companyId|userId|actionUrl/
    );
  });
});
