import { describe, expect, it } from "vitest";

import {
  ListWorkQueueInputSchema,
  WORK_QUEUE_FETCH_LIMIT,
  WORK_QUEUE_MAX_PAGE_ITEMS,
  WORK_QUEUE_MAX_SOURCE_ROWS,
  WORK_QUEUE_SOURCES,
  ListWorkQueueResultSchema,
  WorkQueueCardSchema,
  assertNoWorkQueueForbiddenFields,
  normalizeWorkQueueSelections,
} from "../work-queue";

describe("work queue contract", () => {
  it("defaults to all nine sources in canonical product order", () => {
    expect(WORK_QUEUE_SOURCES).toEqual([
      "task",
      "lead",
      "correspondence",
      "commitment",
      "match_review",
      "schedule",
      "financial_document",
      "payment",
      "expense",
    ]);
    expect(normalizeWorkQueueSelections({})).toEqual(
      WORK_QUEUE_SOURCES.map((source) => ({ source, origin: "default" }))
    );
  });

  it("keeps only a nonempty explicit subset and canonicalizes it", () => {
    expect(
      normalizeWorkQueueSelections({ sources: ["expense", "task", "payment"] })
    ).toEqual([
      { source: "task", origin: "explicit" },
      { source: "payment", origin: "explicit" },
      { source: "expense", origin: "explicit" },
    ]);
  });

  it("rejects empty, duplicate, unknown, and unexpected selectors", () => {
    for (const value of [
      { sources: [] },
      { sources: ["task", "task"] },
      { sources: ["notification"] },
      { sources: ["task"], actor_id: "forged" },
      null,
    ]) {
      expect(() => ListWorkQueueInputSchema.parse(value)).toThrow();
    }
  });

  it("pins the physical 25/26/501 bounds", () => {
    expect(WORK_QUEUE_MAX_PAGE_ITEMS).toBe(25);
    expect(WORK_QUEUE_FETCH_LIMIT).toBe(26);
    expect(WORK_QUEUE_MAX_SOURCE_ROWS).toBe(501);
    expect(() =>
      ListWorkQueueInputSchema.parse({ cursor: "x".repeat(513) })
    ).not.toThrow();
    expect(() => ListWorkQueueInputSchema.parse({ cursor: "short" })).toThrow();
    expect(() =>
      ListWorkQueueInputSchema.parse({ cursor: "x".repeat(8_193) })
    ).toThrow();
  });

  it("matches frozen helper text ceilings and omits nullable display fields", () => {
    const id = "77777777-7777-4777-8777-777777777777";
    const job = {
      kind: "opportunity" as const,
      id: "88888888-8888-4888-8888-888888888888",
    };
    const base = {
      queue_ref: { kind: "lead" as const, id },
      priority: 1,
      attention_at: "2026-08-29T23:30:00.000Z",
    };
    expect(
      WorkQueueCardSchema.parse({
        ...base,
        source: "lead",
        job_ref: { kind: "opportunity", id },
        reason: "follow_up_due",
        content_kind: "untrusted_business_data",
      })
    ).not.toHaveProperty("title");
    expect(() =>
      WorkQueueCardSchema.parse({
        ...base,
        source: "lead",
        job_ref: { kind: "opportunity", id },
        reason: "follow_up_due",
        title: "x".repeat(256),
        content_kind: "untrusted_business_data",
      })
    ).not.toThrow();
    expect(() =>
      WorkQueueCardSchema.parse({
        ...base,
        source: "lead",
        job_ref: { kind: "opportunity", id },
        reason: "follow_up_due",
        title: "x".repeat(257),
        content_kind: "untrusted_business_data",
      })
    ).toThrow();
    expect(() =>
      WorkQueueCardSchema.parse({
        ...base,
        source: "correspondence",
        queue_ref: { kind: "correspondence", id },
        thread_ref: { kind: "email_thread", id },
        job_ref: job,
        reason: "unresolved_correspondence",
        snippet: "",
        content_kind: "untrusted_business_data",
      })
    ).not.toThrow();
    expect(() =>
      WorkQueueCardSchema.parse({
        ...base,
        source: "correspondence",
        queue_ref: { kind: "correspondence", id },
        thread_ref: { kind: "email_thread", id },
        job_ref: job,
        reason: "unresolved_correspondence",
        subject: "x".repeat(512),
        snippet: "",
        content_kind: "untrusted_business_data",
      })
    ).not.toThrow();
    expect(() =>
      WorkQueueCardSchema.parse({
        ...base,
        source: "financial_document",
        queue_ref: { kind: "financial_document", id },
        document_ref: { kind: "estimate", id },
        reason: "estimate_expired",
        document_number: `D${"\n".repeat(254)}N`,
        content_kind: "untrusted_business_data",
      })
    ).not.toThrow();
  });

  it("couples globally ordered typed cards to atomic proof and evidence", () => {
    const readAt = "2026-08-29T23:30:00.000Z";
    const revisions = [{ domain: "tasks", source_revision: 7 }];
    const item = {
      source: "task" as const,
      queue_ref: {
        kind: "task" as const,
        id: "77777777-7777-4777-8777-777777777777",
      },
      priority: 0,
      attention_at: readAt,
      task_ref: {
        kind: "task" as const,
        id: "77777777-7777-4777-8777-777777777777",
      },
      job_ref: {
        kind: "project" as const,
        id: "88888888-8888-4888-8888-888888888888",
      },
      reason: "overdue" as const,
      title: "Replace failed disconnect",
      content_kind: "untrusted_business_data" as const,
    };
    const result = {
      items: [item],
      item_proofs: [
        {
          proof_ref: `ops_proof:v1:${"1".repeat(64)}`,
          read_at: readAt,
          source_revisions: revisions,
        },
      ],
      evidence: [
        {
          evidence_ref: `ops_evidence:v1:${"2".repeat(64)}`,
          source_domain: "work_queue",
          source_type: "task",
          occurred_at: readAt,
        },
      ],
      warnings: [],
      collection_proof: {
        proof_ref: `ops_proof:v1:${"3".repeat(64)}`,
        read_at: readAt,
        source_revisions: revisions,
        returned_count: 1,
        has_more: false,
      },
      next_cursor: null,
    };
    expect(ListWorkQueueResultSchema.parse(result)).toEqual(result);
    expect(() =>
      assertNoWorkQueueForbiddenFields({ provider_id: "leak" })
    ).toThrow();
    const invalid = structuredClone(result);
    invalid.items[0]!.priority = 9;
    expect(() => ListWorkQueueResultSchema.parse(invalid)).toThrow();
    const mismatchedIdentity = structuredClone(result);
    mismatchedIdentity.items[0]!.queue_ref.id =
      "99999999-9999-4999-8999-999999999999";
    expect(() => ListWorkQueueResultSchema.parse(mismatchedIdentity)).toThrow();
    const duplicateIdentity = structuredClone(result);
    duplicateIdentity.items.push(structuredClone(duplicateIdentity.items[0]!));
    duplicateIdentity.item_proofs.push(
      structuredClone(duplicateIdentity.item_proofs[0]!)
    );
    duplicateIdentity.evidence.push(
      structuredClone(duplicateIdentity.evidence[0]!)
    );
    duplicateIdentity.collection_proof.returned_count = 2;
    expect(() => ListWorkQueueResultSchema.parse(duplicateIdentity)).toThrow();
  });
});
