/**
 * Unit tests — classifyDraftOutcome (Part A)
 *
 * Pure classifier: no I/O, no mocks, no async.
 * TDD: write tests first, watch them fail, implement, go green.
 */

import { describe, it, expect } from "vitest";
import {
  classifyDraftOutcome,
  type DraftOutcome,
} from "@/lib/api/services/draft-reconciliation";

describe("classifyDraftOutcome", () => {
  // ── used: draft gone + outbound reply exists ─────────────────────────────
  it("returns 'used' when draft is gone from mailbox and there is an outbound reply", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: true,
      daysSinceDraft: 2,
    });
    expect(result).toBe<DraftOutcome>("used");
  });

  it("returns 'used' regardless of TTL when there is an outbound reply and the draft is gone", () => {
    // TTL is irrelevant when hasOutboundAfter is true and draft is gone
    const result = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: true,
      daysSinceDraft: 30,
      ttlDays: 7,
    });
    expect(result).toBe<DraftOutcome>("used");
  });

  // ── from_scratch: draft still present + outbound reply exists ───────────
  it("returns 'from_scratch' when draft is still in the mailbox but an outbound reply was sent", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: true,
      hasOutboundAfter: true,
      daysSinceDraft: 3,
    });
    expect(result).toBe<DraftOutcome>("from_scratch");
  });

  it("returns 'from_scratch' even when well past the TTL if the draft is still present and a reply was sent", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: true,
      hasOutboundAfter: true,
      daysSinceDraft: 60,
      ttlDays: 14,
    });
    expect(result).toBe<DraftOutcome>("from_scratch");
  });

  // ── discarded: draft gone + no outbound + past TTL ───────────────────────
  it("returns 'discarded' when draft is gone, no outbound reply, and past default TTL (14 days)", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: false,
      daysSinceDraft: 14,
    });
    expect(result).toBe<DraftOutcome>("discarded");
  });

  it("returns 'discarded' when draft is gone, no outbound reply, and past a custom TTL", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: false,
      daysSinceDraft: 8,
      ttlDays: 7,
    });
    expect(result).toBe<DraftOutcome>("discarded");
  });

  it("returns 'discarded' on exactly the TTL boundary (>= is discarded)", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: false,
      daysSinceDraft: 14,
      ttlDays: 14,
    });
    expect(result).toBe<DraftOutcome>("discarded");
  });

  // ── pending: still in mailbox + no outbound ──────────────────────────────
  it("returns 'pending' when draft is still in the mailbox and no outbound reply yet", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: true,
      hasOutboundAfter: false,
      daysSinceDraft: 1,
    });
    expect(result).toBe<DraftOutcome>("pending");
  });

  it("returns 'pending' even when past TTL if the draft is still sitting in the mailbox", () => {
    // Draft still present = user may yet send it; don't call it discarded
    const result = classifyDraftOutcome({
      draftStillInMailbox: true,
      hasOutboundAfter: false,
      daysSinceDraft: 30,
      ttlDays: 14,
    });
    expect(result).toBe<DraftOutcome>("pending");
  });

  // ── pending: draft gone + no outbound + within TTL ───────────────────────
  it("returns 'pending' when draft is gone, no outbound, but within TTL window", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: false,
      daysSinceDraft: 5,
    });
    expect(result).toBe<DraftOutcome>("pending");
  });

  it("returns 'pending' when draft is gone, no outbound, one day before TTL", () => {
    const result = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: false,
      daysSinceDraft: 13,
      ttlDays: 14,
    });
    expect(result).toBe<DraftOutcome>("pending");
  });

  it("uses 14 days as the default TTL when ttlDays is not provided", () => {
    // 13 days → still pending with default 14-day TTL
    const pendingResult = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: false,
      daysSinceDraft: 13,
    });
    expect(pendingResult).toBe<DraftOutcome>("pending");

    // 14 days → now discarded with default TTL
    const discardedResult = classifyDraftOutcome({
      draftStillInMailbox: false,
      hasOutboundAfter: false,
      daysSinceDraft: 14,
    });
    expect(discardedResult).toBe<DraftOutcome>("discarded");
  });
});
