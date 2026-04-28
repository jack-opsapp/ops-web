import { describe, it, expect } from "vitest";
import {
  evaluateThresholds,
  severityRank,
  BOUNCE_WARN_PCT,
  BOUNCE_CRIT_PCT,
  SPAM_WARN_PCT,
  SPAM_CRIT_PCT,
  DELIVERY_WARN_PCT,
  MIN_SENDS_FOR_PCT,
  type MetricSnapshot,
} from "@/lib/email/anomaly-thresholds";

const baseSnapshot: MetricSnapshot = {
  windowMinutes: 15,
  totalSent: 100,
  totalDelivered: 95,
  totalBounced: 1,
  bouncePct: 1,
  totalSpam: 0,
  spamPct: 0,
  totalOpen: 30,
  openPct: 31.5,
  totalClick: 5,
  clickPct: 5.2,
  errorEvents: 0,
};

describe("evaluateThresholds", () => {
  it("clean snapshot yields no anomalies", () => {
    expect(evaluateThresholds(baseSnapshot)).toEqual([]);
  });

  it("bounce_pct >= 5% triggers warn", () => {
    const r = evaluateThresholds({
      ...baseSnapshot,
      totalBounced: 5,
      bouncePct: BOUNCE_WARN_PCT,
    });
    expect(r.find((x) => x.kind === "bounce_spike")?.severity).toBe("warn");
  });

  it("bounce_pct >= 10% escalates to critical", () => {
    const r = evaluateThresholds({
      ...baseSnapshot,
      totalBounced: 12,
      bouncePct: BOUNCE_CRIT_PCT + 2,
    });
    expect(r.find((x) => x.kind === "bounce_spike")?.severity).toBe("critical");
  });

  it("low send volume suppresses bounce alert (under MIN_SENDS_FOR_PCT)", () => {
    const r = evaluateThresholds({
      ...baseSnapshot,
      totalSent: MIN_SENDS_FOR_PCT - 1,
      totalBounced: 1,
      bouncePct: 50,
    });
    expect(r.find((x) => x.kind === "bounce_spike")).toBeUndefined();
  });

  it("spam 0.1% triggers warn", () => {
    const r = evaluateThresholds({ ...baseSnapshot, spamPct: SPAM_WARN_PCT });
    expect(r.find((x) => x.kind === "spam_spike")?.severity).toBe("warn");
  });

  it("spam 0.5% escalates to critical", () => {
    const r = evaluateThresholds({ ...baseSnapshot, spamPct: SPAM_CRIT_PCT });
    expect(r.find((x) => x.kind === "spam_spike")?.severity).toBe("critical");
  });

  it("low delivered volume suppresses spam alert", () => {
    const r = evaluateThresholds({
      ...baseSnapshot,
      totalDelivered: MIN_SENDS_FOR_PCT - 1,
      spamPct: 99,
    });
    expect(r.find((x) => x.kind === "spam_spike")).toBeUndefined();
  });

  it("delivery 70% triggers warn", () => {
    const r = evaluateThresholds({ ...baseSnapshot, totalDelivered: 70 });
    expect(r.find((x) => x.kind === "delivery_drop")?.severity).toBe("warn");
  });

  it("delivery 50% escalates to critical", () => {
    const r = evaluateThresholds({ ...baseSnapshot, totalDelivered: 50 });
    expect(r.find((x) => x.kind === "delivery_drop")?.severity).toBe(
      "critical"
    );
  });

  it("delivery at threshold yields no alert", () => {
    const r = evaluateThresholds({
      ...baseSnapshot,
      totalDelivered: DELIVERY_WARN_PCT,
    });
    expect(r.find((x) => x.kind === "delivery_drop")).toBeUndefined();
  });

  it("volume drop with baseline triggers warn", () => {
    const r = evaluateThresholds({
      ...baseSnapshot,
      totalSent: 5,
      baselineSent: 1000,
      baselineWindowMinutes: 60,
    });
    expect(r.find((x) => x.kind === "volume_drop")).toBeTruthy();
  });

  it("volume drop ratio < 1% escalates to critical", () => {
    const r = evaluateThresholds({
      ...baseSnapshot,
      totalSent: 5,
      baselineSent: 100000,
      baselineWindowMinutes: 60,
    });
    expect(r.find((x) => x.kind === "volume_drop")?.severity).toBe("critical");
  });

  it("no baseline → no volume_drop", () => {
    const r = evaluateThresholds({ ...baseSnapshot, totalSent: 1 });
    expect(r.find((x) => x.kind === "volume_drop")).toBeUndefined();
  });

  it("multiple anomalies stack independently", () => {
    const r = evaluateThresholds({
      ...baseSnapshot,
      totalBounced: 12,
      bouncePct: 12,
      spamPct: 0.6,
    });
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.find((x) => x.kind === "bounce_spike")?.severity).toBe("critical");
    expect(r.find((x) => x.kind === "spam_spike")?.severity).toBe("critical");
  });

  it("severityRank orders critical above warn", () => {
    expect(severityRank("critical")).toBeGreaterThan(severityRank("warn"));
  });
});
