import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, profileRows } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  profileRows: [] as Array<Record<string, unknown>>,
}));

/**
 * `updateFromEmail` reads and writes exactly one table; the chain below answers
 * it without pretending to be a database.
 */
vi.mock("@/lib/supabase/helpers", () => {
  function query() {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.insert = (payload: Record<string, unknown>) => {
      profileRows.push(payload);
      return Promise.resolve({ data: null, error: null });
    };
    chain.update = () => chain;
    chain.single = async () => ({
      data: profileRows[0] ?? null,
      error: profileRows[0] ? null : { message: "no rows" },
    });
    return chain;
  }
  return { requireSupabase: () => ({ rpc: rpcMock, from: () => query() }) };
});

vi.mock("./openai-clients", () => ({ getSyncOpenAI: () => ({}) }));
vi.mock("@/lib/api/services/openai-clients", () => ({
  getSyncOpenAI: () => ({}),
}));

import { WritingProfileService } from "@/lib/api/services/writing-profile-service";
import { normalizeLearnedSubjectExample } from "@/lib/email/email-subject-policy";

const MERGE_RPC = "merge_agent_writing_profile_subject_preferences";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260830100000_agent_writing_profile_subject_preferences_merge.sql"
);

function rpcArgs(): Record<string, unknown> {
  const call = rpcMock.mock.calls.at(-1);
  if (!call) throw new Error("merge rpc was never called");
  return call[1] as Record<string, unknown>;
}

beforeEach(() => {
  profileRows.length = 0;
  profileRows.push({
    id: "profile-1",
    company_id: "company-1",
    user_id: "user-1",
    profile_type: "client_new_inquiry",
    emails_analyzed: 12,
    formality_score: 0.5,
    avg_sentence_length: 12,
    greeting_patterns: [],
    closing_patterns: [],
    vocabulary_preferences: {},
    tone_traits: {},
  });
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({
    data: { learned: true, pattern: "{contact} deck quote", count: 3 },
    error: null,
  });
});

describe("new-thread subject learning", () => {
  it("merges a prefix-free thread-opening subject into the profile", async () => {
    const result = await WritingProfileService.learnNewThreadSubject({
      companyId: "company-1",
      userId: "user-1",
      profileType: "client_new_inquiry",
      subject: "  Canpro Deck and Rail   Estimate ",
      context: {
        contact: "Sandra Dunford",
        address: "18 Cedar Road",
        project: "Cedar Road deck",
      },
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toBe(MERGE_RPC);
    expect(rpcArgs()).toMatchObject({
      p_company_id: "company-1",
      p_user_id: "user-1",
      p_profile_type: "client_new_inquiry",
      p_subject: "Canpro Deck and Rail Estimate",
      p_context: {
        contact: "Sandra Dunford",
        address: "18 Cedar Road",
        project: "Cedar Road deck",
      },
      p_dry_run: false,
    });
    expect(result.learned).toBe(true);
  });

  it("defaults the thread-opening determination to the subject's own shape", async () => {
    await WritingProfileService.learnNewThreadSubject({
      companyId: "company-1",
      userId: "user-1",
      subject: "Canpro Deck and Rail Estimate",
    });

    expect(rpcArgs().p_is_thread_opening).toBeNull();
    expect(rpcArgs().p_profile_type).toBe("general");
  });

  it("never learns a reply or forward subject", async () => {
    for (const subject of [
      "Re: Canpro Deck and Rail Estimate",
      "RE[2]: Canpro Deck and Rail Estimate",
      "Fwd: Canpro Deck and Rail Estimate",
      "FW: Canpro Deck and Rail Estimate",
      "Forwarded: Canpro Deck and Rail Estimate",
    ]) {
      const result = await WritingProfileService.learnNewThreadSubject({
        companyId: "company-1",
        userId: "user-1",
        subject,
      });
      expect(result.learned).toBe(false);
      expect(result.reason).toBe("not_thread_opening");
    }

    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("refuses a send the caller knows is not thread-opening", async () => {
    const result = await WritingProfileService.learnNewThreadSubject({
      companyId: "company-1",
      userId: "user-1",
      subject: "Canpro Deck and Rail Estimate",
      isThreadOpening: false,
    });

    expect(result.learned).toBe(false);
    expect(result.reason).toBe("not_thread_opening");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("passes an explicit thread-opening determination through to the merge", async () => {
    await WritingProfileService.learnNewThreadSubject({
      companyId: "company-1",
      userId: "user-1",
      subject: "Canpro Deck and Rail Estimate",
      isThreadOpening: true,
    });

    expect(rpcArgs().p_is_thread_opening).toBe(true);
  });

  it("refuses blank and oversized subjects before touching the database", async () => {
    for (const subject of ["", "   ", "x".repeat(201)]) {
      const result = await WritingProfileService.learnNewThreadSubject({
        companyId: "company-1",
        userId: "user-1",
        subject,
      });
      expect(result.learned).toBe(false);
      expect(result.reason).toBe("not_thread_opening");
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces a merge failure instead of swallowing it", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function" },
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await WritingProfileService.learnNewThreadSubject({
      companyId: "company-1",
      userId: "user-1",
      subject: "Canpro Deck and Rail Estimate",
    });

    expect(result.learned).toBe(false);
    expect(result.error).toContain("permission denied for function");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("previews without writing when the caller asks for a dry run", async () => {
    rpcMock.mockResolvedValue({
      data: { learned: false, reason: "dry_run", pattern: "{contact} deck" },
      error: null,
    });

    const result = await WritingProfileService.learnNewThreadSubject({
      companyId: "company-1",
      userId: "user-1",
      subject: "Sandra Dunford deck",
      context: { contact: "Sandra Dunford" },
      dryRun: true,
    });

    expect(rpcArgs().p_dry_run).toBe(true);
    expect(result.pattern).toBe("{contact} deck");
  });
});

describe("profile updates that carry a subject", () => {
  it("learns the subject alongside the body it just analyzed", async () => {
    await WritingProfileService.updateFromEmail(
      "company-1",
      "user-1",
      {
        bodyText: "Hi Sandra,\n\nHappy to quote the deck.\n\nThanks,\nJackson",
        subject: "Canpro Deck and Rail Estimate",
        subjectContext: { contact: "Sandra Dunford" },
      },
      "client_new_inquiry"
    );

    expect(rpcMock).toHaveBeenCalledWith(
      MERGE_RPC,
      expect.objectContaining({
        p_company_id: "company-1",
        p_user_id: "user-1",
        p_profile_type: "client_new_inquiry",
        p_subject: "Canpro Deck and Rail Estimate",
      })
    );
  });

  it("leaves the learner untouched when the sample carries no subject", async () => {
    await WritingProfileService.updateFromEmail("company-1", "user-1", {
      bodyText: "Hi Sandra,\n\nHappy to quote the deck.\n\nThanks,\nJackson",
    });

    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("learned-subject example normalization", () => {
  it("collapses whitespace and keeps a prefix-free subject", () => {
    expect(normalizeLearnedSubjectExample("  Canpro   Deck\nEstimate ")).toBe(
      "Canpro Deck Estimate"
    );
  });

  it("rejects replies, forwards, blanks, and oversized subjects", () => {
    expect(normalizeLearnedSubjectExample("Re: Estimate")).toBeNull();
    expect(normalizeLearnedSubjectExample("Fwd: Estimate")).toBeNull();
    expect(normalizeLearnedSubjectExample("   ")).toBeNull();
    expect(normalizeLearnedSubjectExample("x".repeat(201))).toBeNull();
  });
});

describe("subject-preference merge migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");

  it("writes the exact shape the draft-time reader consumes", () => {
    expect(sql).toContain("preferred_patterns");
    expect(sql).toContain("'pattern'");
    expect(sql).toContain("'count'");
    expect(sql).not.toMatch(/'template'/);
  });

  it("is service-role only and search-path pinned", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("auth.role(), '') <> 'service_role'");
    expect(sql).toMatch(/revoke all on function[\s\S]*from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function[\s\S]*to service_role/);
  });

  it("caps the stored patterns so learning cannot grow without bound", () => {
    expect(sql).toContain("10");
    expect(sql).toContain("order by");
  });
});
