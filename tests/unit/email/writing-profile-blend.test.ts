/**
 * A thin type-specific writing profile must never shadow the rich general one.
 *
 * The contact-form incident drafted in nobody's voice because
 * `getProfile("client_new_inquiry")` returned a 10-email profile outright while
 * a 1,973-email general profile sat unused. Ten emails is not a voice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const database = {
  profiles: [] as Row[],
};

vi.mock("@/lib/supabase/helpers", () => {
  function query() {
    const filters: Array<[string, unknown]> = [];
    let orderColumn: string | null = null;
    let ascending = true;
    let rowLimit: number | null = null;

    const matching = () => {
      let rows = database.profiles.filter((row) =>
        filters.every(([column, value]) => row[column] === value)
      );
      if (orderColumn) {
        const column = orderColumn;
        rows = [...rows].sort((left, right) => {
          const a = Number(left[column] ?? 0);
          const b = Number(right[column] ?? 0);
          return ascending ? a - b : b - a;
        });
      }
      if (rowLimit != null) rows = rows.slice(0, rowLimit);
      return rows;
    };

    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    };
    chain.order = (column: string, options: { ascending?: boolean } = {}) => {
      orderColumn = column;
      ascending = options.ascending !== false;
      return chain;
    };
    chain.limit = (value: number) => {
      rowLimit = value;
      return chain;
    };
    chain.single = async () => {
      const rows = matching();
      return {
        data: rows.length === 1 ? rows[0] : null,
        error: rows.length === 1 ? null : { message: "no rows" },
      };
    };
    return chain;
  }

  return { requireSupabase: () => ({ from: () => query() }) };
});

import {
  TYPE_PROFILE_STANDALONE_MIN,
  WritingProfileService,
} from "@/lib/api/services/writing-profile-service";

const COMPANY = "company-1";
const USER = "user-1";

function profileRow(overrides: Row): Row {
  return {
    company_id: COMPANY,
    user_id: USER,
    greeting_patterns: [],
    closing_patterns: [],
    tone_traits: {},
    vocabulary_preferences: {},
    ...overrides,
  };
}

beforeEach(() => {
  database.profiles = [];
});

describe("WritingProfileService.getProfile — type-profile standalone threshold", () => {
  it("requires 50 analyzed emails before a type profile stands alone", () => {
    expect(TYPE_PROFILE_STANDALONE_MIN).toBe(50);
  });

  it("blends a 10-email type profile toward the rich general profile", async () => {
    database.profiles = [
      profileRow({
        profile_type: "client_new_inquiry",
        emails_analyzed: 10,
        formality_score: 0.9,
        avg_sentence_length: 30,
      }),
      profileRow({
        profile_type: "general",
        emails_analyzed: 1973,
        formality_score: 0.4,
        avg_sentence_length: 12,
        closing_patterns: ["Cheers,"],
        greeting_patterns: ["Hey {name},"],
      }),
    ];

    const profile = await WritingProfileService.getProfile(
      COMPANY,
      USER,
      "client_new_inquiry"
    );

    // weight = 10/50 = 0.2 — the general profile carries 80%.
    expect(profile?.formality_score).toBeCloseTo(0.5, 10);
    expect(profile?.avg_sentence_length).toBeCloseTo(15.6, 10);
    // The thin profile has no greetings/closings of its own, so the general
    // profile's learned patterns win outright.
    expect(profile?.closing_patterns).toEqual(["Cheers,"]);
    expect(profile?.greeting_patterns).toEqual(["Hey {name},"]);
  });

  it("still blends at the old standalone threshold of 10 emails", async () => {
    database.profiles = [
      profileRow({
        profile_type: "client_new_inquiry",
        emails_analyzed: 25,
        formality_score: 1,
        avg_sentence_length: 20,
      }),
      profileRow({
        profile_type: "general",
        emails_analyzed: 1973,
        formality_score: 0,
        avg_sentence_length: 10,
      }),
    ];

    const profile = await WritingProfileService.getProfile(
      COMPANY,
      USER,
      "client_new_inquiry"
    );

    // weight = 25/50 = 0.5
    expect(profile?.formality_score).toBeCloseTo(0.5, 10);
    expect(profile?.avg_sentence_length).toBeCloseTo(15, 10);
  });

  it("uses a 50-email type profile as-is", async () => {
    database.profiles = [
      profileRow({
        profile_type: "client_new_inquiry",
        emails_analyzed: 50,
        formality_score: 0.9,
        avg_sentence_length: 30,
      }),
      profileRow({
        profile_type: "general",
        emails_analyzed: 1973,
        formality_score: 0.4,
        avg_sentence_length: 12,
      }),
    ];

    const profile = await WritingProfileService.getProfile(
      COMPANY,
      USER,
      "client_new_inquiry"
    );

    expect(profile?.emails_analyzed).toBe(50);
    expect(profile?.formality_score).toBe(0.9);
    expect(profile?.avg_sentence_length).toBe(30);
  });

  it("returns the general profile untouched when no type profile exists", async () => {
    database.profiles = [
      profileRow({
        profile_type: "general",
        emails_analyzed: 1973,
        formality_score: 0.4,
        avg_sentence_length: 12,
      }),
    ];

    const profile = await WritingProfileService.getProfile(
      COMPANY,
      USER,
      "client_new_inquiry"
    );

    expect(profile?.profile_type).toBe("general");
    expect(profile?.formality_score).toBe(0.4);
  });

  it("keeps a thin type profile when there is no general profile to blend with", async () => {
    database.profiles = [
      profileRow({
        profile_type: "client_new_inquiry",
        emails_analyzed: 10,
        formality_score: 0.9,
      }),
    ];

    const profile = await WritingProfileService.getProfile(
      COMPANY,
      USER,
      "client_new_inquiry"
    );

    expect(profile?.profile_type).toBe("client_new_inquiry");
    expect(profile?.formality_score).toBe(0.9);
  });
});

describe("WritingProfileService.blendProfiles", () => {
  it("clamps the specific-profile weight to the 0..1 range", () => {
    const specific = { formality_score: 1, avg_sentence_length: 20 };
    const general = { formality_score: 0, avg_sentence_length: 10 };

    const over = WritingProfileService.blendProfiles(specific, general, 500);
    expect(over.formality_score).toBeCloseTo(1, 10);
    expect(over.avg_sentence_length).toBeCloseTo(20, 10);

    const under = WritingProfileService.blendProfiles(specific, general, -5);
    expect(under.formality_score).toBeCloseTo(0, 10);
    expect(under.avg_sentence_length).toBeCloseTo(10, 10);
  });

  it("weights the specific profile by count / 50", () => {
    const blended = WritingProfileService.blendProfiles(
      { formality_score: 1 },
      { formality_score: 0 },
      10
    );

    expect(blended.formality_score).toBeCloseTo(0.2, 10);
  });
});
