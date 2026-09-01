import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260813120000_agent_job_communication_participants.sql"
  ),
  "utf8"
).toLowerCase();

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const COMPACT_SQL = compact(SQL);

describe("Task 12 manifest-v5 RPC compatibility", () => {
  it.each([
    {
      publicName: "read_agent_job_conversation_context_as_system",
      privateName: "read_agent_job_conversation_context_v4_impl",
    },
    {
      publicName: "read_agent_correspondence_evidence_as_system",
      privateName: "read_agent_correspondence_evidence_v4_impl",
    },
    {
      publicName: "read_agent_scheduled_jobs_as_system",
      privateName: "read_agent_scheduled_jobs_v4_impl",
    },
    {
      publicName: "read_agent_job_readiness_issues_as_system",
      privateName: "read_agent_job_readiness_issues_v4_impl",
    },
  ])(
    "keeps $publicName available through a service-role-only v5 wrapper",
    ({ publicName, privateName }) => {
      expect(COMPACT_SQL).toContain(`alter function public.${publicName}(`);
      expect(COMPACT_SQL).toContain(`to_regprocedure('public.${publicName}(`);
      expect(COMPACT_SQL).toContain(`rename to ${privateName}`);
      expect(COMPACT_SQL).toContain(`alter function public.${privateName}(`);
      expect(COMPACT_SQL).toContain("set schema private");
      expect(COMPACT_SQL).toContain(
        `revoke all on function private.${privateName}(`
      );
      expect(COMPACT_SQL).toContain(
        `create or replace function public.${publicName}(`
      );
      expect(COMPACT_SQL).toContain(`private.${privateName}(`);
      expect(COMPACT_SQL).toContain(
        "p_capability_manifest_revision is distinct from '2026-08-13.capability-manifest.v5'"
      );
      expect(COMPACT_SQL).toContain("'2026-08-12.capability-manifest.v4'");
      expect(COMPACT_SQL).toMatch(
        new RegExp(
          `revoke all on function public\\.${publicName}\\([\\s\\S]*?from public, anon, authenticated, service_role;`
        )
      );
      expect(COMPACT_SQL).toMatch(
        new RegExp(
          `grant execute on function public\\.${publicName}\\([\\s\\S]*?to service_role;`
        )
      );
    }
  );

  it("never exposes the v4 implementations or lets a wrapper accept arbitrary revisions", () => {
    expect(COMPACT_SQL).not.toMatch(
      /grant execute on function private\.read_agent_[a-z_]+_v4_impl\(/
    );
    for (const privateName of [
      "read_agent_job_conversation_context_v4_impl",
      "read_agent_correspondence_evidence_v4_impl",
      "read_agent_scheduled_jobs_v4_impl",
      "read_agent_job_readiness_issues_v4_impl",
    ]) {
      const calls = COMPACT_SQL.match(
        new RegExp(`private\\.${privateName}\\([^;]+`, "g")
      );
      expect(calls).not.toBeNull();
      expect(
        calls!.some((call) => call.includes("p_capability_manifest_revision"))
      ).toBe(false);
    }
  });
});
