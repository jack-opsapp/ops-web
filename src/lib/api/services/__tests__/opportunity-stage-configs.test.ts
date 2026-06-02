import { describe, it, expect, vi } from "vitest";

// Mock Supabase helpers to avoid Firebase initialization. The mapper relies on
// parseDate; the service method (not exercised here) relies on requireSupabase.
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: vi.fn(),
  parseDate: (v: unknown) => (v ? new Date(v as string) : null),
  parseDateRequired: (v: unknown) => (v ? new Date(v as string) : new Date()),
}));

import { mapStageConfigRow } from "../opportunity-service";
import { stageConfigBySlug } from "@/lib/hooks/pipeline-table/use-pipeline-stage-configs";
import { FollowUpType, type PipelineStageConfig } from "@/lib/types/pipeline";

describe("mapStageConfigRow", () => {
  it("maps a snake_case row into a camelCase PipelineStageConfig", () => {
    const row = {
      id: "cfg-1",
      company_id: "comp-1",
      name: "Quoting",
      slug: "quoting",
      color: "#C4A868",
      icon: "document",
      sort_order: 2,
      is_default: true,
      is_won_stage: false,
      is_lost_stage: false,
      default_win_probability: 40,
      auto_follow_up_days: 3,
      auto_follow_up_type: "quote_follow_up",
      stale_threshold_days: 5,
      created_at: "2026-02-17T12:00:00Z",
      deleted_at: null,
    };

    const config = mapStageConfigRow(row);

    expect(config.id).toBe("cfg-1");
    expect(config.companyId).toBe("comp-1");
    expect(config.name).toBe("Quoting");
    expect(config.slug).toBe("quoting");
    expect(config.color).toBe("#C4A868");
    expect(config.icon).toBe("document");
    expect(config.sortOrder).toBe(2);
    expect(config.isDefault).toBe(true);
    expect(config.isWonStage).toBe(false);
    expect(config.isLostStage).toBe(false);
    expect(config.defaultWinProbability).toBe(40);
    expect(config.autoFollowUpDays).toBe(3);
    expect(config.autoFollowUpType).toBe(FollowUpType.QuoteFollowUp);
    expect(config.staleThresholdDays).toBe(5);
    expect(config.createdAt).toBeInstanceOf(Date);
    expect(config.deletedAt).toBeNull();
  });

  it("maps a won terminal stage with a null auto_follow_up_type", () => {
    const row = {
      id: "cfg-won",
      company_id: "comp-1",
      name: "Won",
      slug: "won",
      color: "#9DB582",
      icon: null,
      sort_order: 6,
      is_default: false,
      is_won_stage: true,
      is_lost_stage: false,
      default_win_probability: 100,
      auto_follow_up_days: null,
      auto_follow_up_type: null,
      stale_threshold_days: 14,
      created_at: "2026-02-17T12:00:00Z",
      deleted_at: null,
    };

    const config = mapStageConfigRow(row);

    expect(config.slug).toBe("won");
    expect(config.isWonStage).toBe(true);
    expect(config.icon).toBeNull();
    expect(config.autoFollowUpDays).toBeNull();
    expect(config.autoFollowUpType).toBeNull();
    expect(config.defaultWinProbability).toBe(100);
  });

  it("coalesces nullable numerics and booleans to the schema defaults", () => {
    // A malformed/partial row where the nullable columns came back null. The
    // model type is non-nullable, so the mapper must fall back to the DB
    // defaults (win prob 10, stale threshold 7, flags false).
    const row = {
      id: "cfg-partial",
      company_id: "comp-1",
      name: "Custom",
      slug: "custom",
      color: "#BCBCBC",
      icon: null,
      sort_order: 9,
      is_default: null,
      is_won_stage: null,
      is_lost_stage: null,
      default_win_probability: null,
      auto_follow_up_days: null,
      auto_follow_up_type: null,
      stale_threshold_days: null,
      created_at: null,
      deleted_at: null,
    };

    const config = mapStageConfigRow(row);

    expect(config.defaultWinProbability).toBe(10);
    expect(config.staleThresholdDays).toBe(7);
    expect(config.isDefault).toBe(false);
    expect(config.isWonStage).toBe(false);
    expect(config.isLostStage).toBe(false);
    expect(config.createdAt).toBeNull();
  });
});

describe("stageConfigBySlug", () => {
  const make = (slug: string, overrides: Partial<PipelineStageConfig> = {}): PipelineStageConfig => ({
    id: `cfg-${slug}`,
    companyId: "comp-1",
    name: slug,
    slug,
    color: "#BCBCBC",
    icon: null,
    sortOrder: 0,
    isDefault: false,
    isWonStage: false,
    isLostStage: false,
    defaultWinProbability: 25,
    autoFollowUpDays: null,
    autoFollowUpType: null,
    staleThresholdDays: 7,
    createdAt: null,
    deletedAt: null,
    ...overrides,
  });

  it("builds a Map keyed by slug with the correct config values", () => {
    const configs = [
      make("new_lead", { defaultWinProbability: 10, staleThresholdDays: 3 }),
      make("quoting", { defaultWinProbability: 40, staleThresholdDays: 5 }),
      make("won", { isWonStage: true, defaultWinProbability: 100 }),
    ];

    const map = stageConfigBySlug(configs);

    expect(map.size).toBe(3);
    expect(map.get("new_lead")?.defaultWinProbability).toBe(10);
    expect(map.get("new_lead")?.staleThresholdDays).toBe(3);
    expect(map.get("quoting")?.defaultWinProbability).toBe(40);
    expect(map.get("won")?.isWonStage).toBe(true);
    expect(map.get("nonexistent")).toBeUndefined();
  });

  it("returns an empty Map for an empty config list", () => {
    const map = stageConfigBySlug([]);
    expect(map.size).toBe(0);
  });
});
