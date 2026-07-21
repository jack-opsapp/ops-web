import { beforeEach, describe, expect, it, vi } from "vitest";

type EmailSample = { subject: string; bodyText: string; date: string };

const mocks = vi.hoisted(() => ({
  chatCreate: vi.fn(),
  profiles: new Map<string, Record<string, unknown>>(),
  upsertCalls: [] as Array<Record<string, unknown>>,
  upsertOptions: [] as Array<{ onConflict?: string } | undefined>,
  upsertError: null as { message: string } | null,
}));

vi.mock("@/lib/api/services/openai-clients", () => ({
  getSyncOpenAI: () => ({
    chat: {
      completions: {
        create: (...args: unknown[]) => mocks.chatCreate(...args),
      },
    },
  }),
}));

vi.mock("@/lib/api/services/writing-profile-service", () => ({
  WritingProfileService: {
    normalizeToneTraits: (traits: unknown) => traits ?? {},
  },
}));

vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      if (table !== "agent_writing_profiles") {
        throw new Error(`Unexpected table ${table}`);
      }
      return {
        upsert: async (
          payload: Record<string, unknown>,
          options?: { onConflict?: string }
        ) => {
          mocks.upsertCalls.push(payload);
          mocks.upsertOptions.push(options);
          if (mocks.upsertError) {
            return { data: null, error: mocks.upsertError };
          }
          const key =
            options?.onConflict === "company_id,user_id,profile_type"
              ? [
                  payload.company_id,
                  payload.user_id,
                  payload.profile_type,
                ].join(":")
              : `${mocks.profiles.size}:${String(payload.profile_type)}`;
          mocks.profiles.set(key, payload);
          return { data: null, error: null };
        },
      };
    },
  }),
}));

import { MemoryService } from "@/lib/api/services/memory-service";

const EMAILS: EmailSample[] = [
  {
    subject: "Estimate for framing",
    bodyText: "Hi Jordan, attached is the estimate. Thanks, Jackson",
    date: "2026-07-20T12:00:00.000Z",
  },
  {
    subject: "Site visit",
    bodyText: "Hey Jordan, Tuesday at 9 works for us. Thanks, Jackson",
    date: "2026-07-19T12:00:00.000Z",
  },
];

function samples(): Map<string, EmailSample[]> {
  return new Map([["client_new_inquiry", EMAILS]]);
}

describe("Phase C writing profile finalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profiles.clear();
    mocks.upsertCalls.length = 0;
    mocks.upsertOptions.length = 0;
    mocks.upsertError = null;
    mocks.chatCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              greeting_patterns: ["Hi {name},"],
              closing_patterns: ["Thanks,"],
              avg_sentence_length: 9,
              formality_score: 0.5,
              tone_traits: { direct: true, warm: true },
              vocabulary_preferences: ["attached"],
              common_phrases: ["works for us"],
              hedging_tendency: 0.1,
              punctuation_habits: { exclamation_marks: 0 },
            }),
          },
        },
      ],
    });
  });

  it("rejects Phase C profile generation when the model request fails", async () => {
    mocks.chatCreate.mockRejectedValue(new Error("profile model unavailable"));

    await expect(
      MemoryService.buildWritingProfiles("company-1", "user-1", samples())
    ).rejects.toThrow("profile model unavailable");

    expect(mocks.upsertCalls).toHaveLength(0);
  });

  it("rejects Phase C profile generation when the Supabase upsert returns an error", async () => {
    mocks.upsertError = { message: "profile storage unavailable" };

    await expect(
      MemoryService.buildWritingProfiles("company-1", "user-1", samples())
    ).rejects.toThrow("profile storage unavailable");

    expect(mocks.profiles).toHaveLength(0);
  });

  it("keeps successful profile persistence idempotent by canonical profile key", async () => {
    await expect(
      MemoryService.buildWritingProfiles("company-1", "user-1", samples())
    ).resolves.toBe(1);
    await expect(
      MemoryService.buildWritingProfiles("company-1", "user-1", samples())
    ).resolves.toBe(1);

    expect(mocks.upsertCalls).toHaveLength(2);
    expect(mocks.upsertOptions).toEqual([
      { onConflict: "company_id,user_id,profile_type" },
      { onConflict: "company_id,user_id,profile_type" },
    ]);
    expect(mocks.profiles).toHaveLength(1);
  });
});
