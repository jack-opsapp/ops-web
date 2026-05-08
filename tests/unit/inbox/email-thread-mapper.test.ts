/**
 * Coverage for `mapEmailThreadFromDb` — specifically the defensive jsonb
 * parsing of `agent_blocking_question` (Phase 3.2). The rest of the
 * mapper is exercised transitively by the upsertFromEmail / list paths;
 * this file pins the corner cases that pure transitive coverage would
 * miss when Phase C starts writing real escalations.
 */

import { describe, it, expect } from "vitest";
import { mapEmailThreadFromDb } from "@/lib/types/email-thread";

const baseRow: Record<string, unknown> = {
  id: "thread-1",
  company_id: "co-1",
  connection_id: "conn-1",
  provider_thread_id: "prov-1",
  primary_category: "OTHER",
  category_confidence: 0,
  category_classified_at: null,
  category_classifier_version: "v1",
  category_manually_set: false,
  labels: [],
  archived_at: null,
  snoozed_until: null,
  priority_score: 0,
  ai_summary: null,
  subject: "",
  participants: [],
  first_message_at: "2026-05-07T10:00:00Z",
  last_message_at: "2026-05-07T10:00:00Z",
  message_count: 1,
  unread_count: 0,
  latest_direction: null,
  latest_sender_email: null,
  latest_sender_name: null,
  latest_snippet: null,
  opportunity_id: null,
  client_id: null,
  next_commitment_due_at: null,
  has_unresolved_commitments: false,
  agent_blocking_question: null,
  created_at: "2026-05-07T10:00:00Z",
  updated_at: "2026-05-07T10:00:00Z",
};

describe("mapEmailThreadFromDb — agent_blocking_question", () => {
  it("returns null when the column is null", () => {
    const t = mapEmailThreadFromDb({ ...baseRow, agent_blocking_question: null });
    expect(t.agentBlockingQuestion).toBeNull();
  });

  it("returns null when the column is undefined (pre-migration row)", () => {
    const row = { ...baseRow };
    delete (row as Record<string, unknown>).agent_blocking_question;
    const t = mapEmailThreadFromDb(row);
    expect(t.agentBlockingQuestion).toBeNull();
  });

  it("parses a question without options", () => {
    const t = mapEmailThreadFromDb({
      ...baseRow,
      agent_blocking_question: {
        question: "What is the price range?",
        asked_at: "2026-05-07T11:00:00Z",
      },
    });
    expect(t.agentBlockingQuestion).toEqual({
      question: "What is the price range?",
      askedAt: "2026-05-07T11:00:00Z",
    });
  });

  it("parses a question with well-formed options", () => {
    const t = mapEmailThreadFromDb({
      ...baseRow,
      agent_blocking_question: {
        question: "What's the budget?",
        options: [
          { id: "low", label: "$200-300" },
          { id: "high", label: "$400-500" },
        ],
        asked_at: "2026-05-07T11:00:00Z",
      },
    });
    expect(t.agentBlockingQuestion).toEqual({
      question: "What's the budget?",
      options: [
        { id: "low", label: "$200-300" },
        { id: "high", label: "$400-500" },
      ],
      askedAt: "2026-05-07T11:00:00Z",
    });
  });

  it("drops malformed option entries while keeping valid ones", () => {
    const t = mapEmailThreadFromDb({
      ...baseRow,
      agent_blocking_question: {
        question: "Pick one",
        options: [
          { id: "a", label: "Alpha" },
          { id: "", label: "Bad — empty id" },
          { id: "c" }, // missing label
          "garbage string",
          null,
          { id: "b", label: "Beta" },
        ],
        asked_at: "2026-05-07T11:00:00Z",
      },
    });
    expect(t.agentBlockingQuestion?.options).toEqual([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ]);
  });

  it("returns null when the question text is missing", () => {
    const t = mapEmailThreadFromDb({
      ...baseRow,
      agent_blocking_question: { asked_at: "2026-05-07T11:00:00Z" },
    });
    expect(t.agentBlockingQuestion).toBeNull();
  });

  it("returns null when asked_at is missing", () => {
    const t = mapEmailThreadFromDb({
      ...baseRow,
      agent_blocking_question: { question: "?" },
    });
    expect(t.agentBlockingQuestion).toBeNull();
  });

  it("returns null when the column value isn't an object", () => {
    const t = mapEmailThreadFromDb({
      ...baseRow,
      agent_blocking_question: "string-payload",
    });
    expect(t.agentBlockingQuestion).toBeNull();
  });

  it("trims surrounding whitespace from the question text", () => {
    const t = mapEmailThreadFromDb({
      ...baseRow,
      agent_blocking_question: {
        question: "   What's the scope?   ",
        asked_at: "2026-05-07T11:00:00Z",
      },
    });
    expect(t.agentBlockingQuestion?.question).toBe("What's the scope?");
  });

  it("drops the options field when every entry is malformed", () => {
    const t = mapEmailThreadFromDb({
      ...baseRow,
      agent_blocking_question: {
        question: "Pick one",
        options: [{ id: "" }, "garbage"],
        asked_at: "2026-05-07T11:00:00Z",
      },
    });
    expect(t.agentBlockingQuestion).toEqual({
      question: "Pick one",
      askedAt: "2026-05-07T11:00:00Z",
    });
  });

  it("defaults phaseC to 'none' (regression coverage for Phase 3.1 default)", () => {
    const t = mapEmailThreadFromDb(baseRow);
    expect(t.phaseC).toBe("none");
  });
});
