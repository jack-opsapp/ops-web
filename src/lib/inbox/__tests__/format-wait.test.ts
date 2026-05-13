// src/lib/inbox/__tests__/format-wait.test.ts
import { describe, it, expect } from "vitest";
import { formatWaitClock, computeStateTag } from "../format-wait";

describe("formatWaitClock", () => {
  it("formats minutes when < 60m", () => {
    expect(formatWaitClock(45 * 60_000)).toBe("45M");
  });
  it("formats hours when < 24h", () => {
    expect(formatWaitClock(18 * 3600_000)).toBe("18H");
  });
  it("formats days when < 30d", () => {
    expect(formatWaitClock(12 * 86400_000)).toBe("12D");
  });
  it("formats absolute date when ≥ 30d", () => {
    const ms = 35 * 86400_000;
    const out = formatWaitClock(ms, new Date("2026-05-08T00:00:00Z"));
    expect(out).toMatch(/^[A-Z]{3} \d{1,2}$/);
  });
});

describe("computeStateTag", () => {
  it("returns DRAFT_READY when AI draft is loaded", () => {
    const tag = computeStateTag({
      lastInboundAt: Date.now() - 18 * 3600_000,
      lastOutboundAt: null,
      hasAiDraft: true,
      sentByAgentRecently: false,
      labels: ["AWAITING_REPLY"],
      closed: false,
      now: Date.now(),
    });
    expect(tag.kind).toBe("draft_ready");
  });

  it("returns AUTO_SENT for 24h after Claude auto-send", () => {
    const tag = computeStateTag({
      lastInboundAt: Date.now() - 1 * 3600_000,
      lastOutboundAt: Date.now() - 1 * 3600_000,
      hasAiDraft: false,
      sentByAgentRecently: true,
      labels: ["AWAITING_REPLY"],
      closed: false,
      now: Date.now(),
    });
    expect(tag.kind).toBe("auto_sent");
  });

  it("returns OVERDUE rose at 8d unreplied inbound with AWAITING_REPLY", () => {
    const tag = computeStateTag({
      lastInboundAt: Date.now() - 8 * 86400_000,
      lastOutboundAt: Date.now() - 30 * 86400_000,
      hasAiDraft: false,
      sentByAgentRecently: false,
      labels: ["AWAITING_REPLY"],
      closed: false,
      now: Date.now(),
    });
    expect(tag.kind).toBe("overdue");
    expect(tag.tone).toBe("rose");
    expect(tag.prefix).toBe("+8D");
    expect(tag.value).toBe("WAITING");
  });

  it("returns YOURS accent at 18h unreplied inbound with AWAITING_REPLY", () => {
    const tag = computeStateTag({
      lastInboundAt: Date.now() - 18 * 3600_000,
      lastOutboundAt: null,
      hasAiDraft: false,
      sentByAgentRecently: false,
      labels: ["AWAITING_REPLY"],
      closed: false,
      now: Date.now(),
    });
    expect(tag.kind).toBe("yours");
    expect(tag.tone).toBe("accent");
    expect(tag.value).toBe("18H");
  });

  it("collapses to FYI when inbound is unreplied but AWAITING_REPLY is absent", () => {
    // Auto-notification / forwarded form / receipt: classifier saw the inbound
    // message but decided no reply is expected. The new precedence treats this
    // as FYI even though timestamps look like an outstanding inbound.
    const tag = computeStateTag({
      lastInboundAt: Date.now() - 18 * 3600_000,
      lastOutboundAt: null,
      hasAiDraft: false,
      sentByAgentRecently: false,
      labels: [],
      closed: false,
      now: Date.now(),
    });
    expect(tag.kind).toBe("fyi");
    expect(tag.tone).toBe("neutral");
    expect(tag.prefix).toBe("FYI");
  });

  it("collapses to FYI on a 30d-old inbound without AWAITING_REPLY (no alarm escalation)", () => {
    const tag = computeStateTag({
      lastInboundAt: Date.now() - 30 * 86400_000,
      lastOutboundAt: null,
      hasAiDraft: false,
      sentByAgentRecently: false,
      labels: [],
      closed: false,
      now: Date.now(),
    });
    expect(tag.kind).toBe("fyi");
    expect(tag.alarmStrip).toBe(false);
  });

  it("returns CLOSED when thread closed", () => {
    const tag = computeStateTag({
      lastInboundAt: Date.now() - 5 * 86400_000,
      lastOutboundAt: null,
      hasAiDraft: false,
      sentByAgentRecently: false,
      labels: ["AWAITING_REPLY"],
      closed: true,
      now: Date.now(),
    });
    expect(tag.kind).toBe("closed");
    expect(tag.tone).toBe("neutral");
  });
});
