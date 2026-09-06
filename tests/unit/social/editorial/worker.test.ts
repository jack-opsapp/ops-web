import { describe, it, expect } from "vitest";
import {
  runEditorial,
  type EditorialDependencies,
} from "@/lib/social/editorial/worker";
const source = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Handoff",
  slug: "handoff",
  published_at: "2026-09-01T12:00:00Z",
  is_live: true,
  thumbnail_url: null,
  text: "Write the delivery address and material list before the crew leaves the shop.",
};
const submission = {
  contract_version: "2026-09-01",
  source: { type: "blog", id: source.id },
  content: {
    title: "Handoff",
    hook: "Before departure",
    angle: "Prepare the handoff",
    caption: "Write the delivery address.",
    cta: "Save this.",
    alt_text: "A crew handoff note.",
    slides: [{ headline: "Handoff", body: "Write the address." }],
  },
};
function rig(mode = "prepare") {
  let stored: any = {
    slot_date: "2026-09-07",
    kind: "blog",
    mode,
    state: "working",
    attempts: 1,
    claim_token: "token",
    package: null,
    source_snapshot: null,
  };
  const calls: string[] = [];
  let currentMode = mode;
  let live = true;
  let existing: any = null;
  const deps: EditorialDependencies = {
    now: () => new Date("2026-09-07T17:00:00Z"),
    token: () => "token",
    repository: {
      claim: async () => stored,
      context: async () => ({
        sources: [source],
        usedSourceIds: [],
        recentHooks: [],
      }),
      checkpoint: async (_r, s, p) => {
        stored = { ...stored, source_snapshot: s, package: p };
        calls.push(p ? "checkpoint" : "source");
        return true;
      },
      finish: async (_r, state) => {
        stored.state = state;
        calls.push(state);
        return state;
      },
      deliveryAllowed: async () => currentMode === "publish",
      sourceStillCurrent: async () => live,
      findPost: async () => existing,
      recordAttempt: async () => {},
    },
    preview: async () => [],
    generate: async () => {
      calls.push("generate");
      return {
        submission,
        evidence: [],
        review: { approved: true },
        usage: [],
      };
    },
    submit: async () => {
      calls.push("submit");
      return { post: { id: "post", status: "review" } };
    },
  } as EditorialDependencies;
  return {
    deps,
    calls,
    get stored() {
      return stored;
    },
    mode: (m: string) => (currentMode = m),
    withdraw: () => (live = false),
    existing: (post: any) => (existing = post),
  };
}
describe("durable editorial worker", () => {
  it("retries a provider failure using the checkpointed source even when history contains it", async () => {
    const r = rig();
    r.stored.source_snapshot = source;
    r.deps.repository.context = async () => ({
      sources: [source],
      usedSourceIds: [source.id],
      recentHooks: [],
    });
    await runEditorial(r.deps);
    expect(r.calls).toContain("generate");
    expect(r.stored.state).toBe("prepared");
  });
  it("prepare mode checkpoints but never submits", async () => {
    const r = rig();
    expect(await runEditorial(r.deps)).toEqual({
      state: "prepared",
      date: "2026-09-07",
    });
    expect(r.calls).toEqual([
      "source",
      "generate",
      "checkpoint",
      "checkpoint",
      "prepared",
    ]);
  });
  it("hands reviewed content off only after checkpoint and live controls", async () => {
    const r = rig("publish");
    await runEditorial(r.deps);
    expect(r.calls).toEqual([
      "source",
      "generate",
      "checkpoint",
      "submit",
      "submitted",
    ]);
  });
  it("turning off prevents a prepared handoff", async () => {
    const r = rig("publish");
    r.mode("off");
    await runEditorial(r.deps);
    expect(r.calls).not.toContain("submit");
    expect(r.stored.state).toBe("skipped");
  });
  it("withdrawn source prevents publication", async () => {
    const r = rig("publish");
    r.withdraw();
    await runEditorial(r.deps);
    expect(r.calls).not.toContain("submit");
    expect(r.stored.state).toBe("skipped");
  });
  it("reconciles successful delivery after lost acknowledgement without rewriting or resubmitting", async () => {
    const r = rig("publish");
    r.stored.package = { submission };
    r.stored.source_snapshot = source;
    r.existing({ id: "post", status: "review" });
    await runEditorial(r.deps);
    expect(r.calls).toEqual(["submitted"]);
  });
  it("never treats a failed rendering reservation as delivered", async () => {
    const r = rig("publish");
    r.stored.package = { submission };
    r.stored.source_snapshot = source;
    r.existing({ id: "post", status: "failed" });
    await runEditorial(r.deps);
    expect(r.calls).toEqual(["failed"]);
  });
  it("stale checkpoint owner cannot submit", async () => {
    const r = rig("publish");
    r.deps.repository.checkpoint = async () => false;
    expect(await runEditorial(r.deps)).toEqual({
      state: "lease_lost",
      date: "2026-09-07",
    });
    expect(r.calls).not.toContain("submit");
  });
  it("source and model failures are bounded retry outcomes", async () => {
    const r = rig();
    r.deps.generate = async () => {
      throw new Error("private provider text");
    };
    await runEditorial(r.deps);
    expect(r.stored.state).toBe("retry");
  });
  it("never catches up a weekend slot", async () => {
    const r = rig();
    r.deps.now = () => new Date("2026-09-05T17:00:00Z");
    expect(await runEditorial(r.deps)).toEqual({ state: "outside_window" });
    expect(r.calls).toEqual([]);
  });
});

describe("explicit manual preparation", () => {
  it("prepares today's weekend draft without falsifying the date or submitting", async () => {
    const r = rig();
    r.deps.now = () => new Date("2026-09-06T01:00:00Z");
    r.stored.slot_date = "2026-09-05";
    let claimed: unknown;
    r.deps.repository.claim = async (...args) => {
      claimed = args;
      return r.stored;
    };
    expect(await runEditorial(r.deps, { prepareDate: "2026-09-05" })).toEqual({
      state: "prepared",
      date: "2026-09-05",
    });
    expect(claimed).toEqual(["2026-09-05", "blog", "token"]);
    expect(r.calls).toContain("generate");
    expect(r.calls).not.toContain("submit");
  });
  it("rejects a manual date other than today's Vancouver date before claiming", async () => {
    const r = rig();
    r.deps.now = () => new Date("2026-09-06T01:00:00Z");
    r.deps.repository.claim = async () => {
      throw Error("must not claim");
    };
    expect(await runEditorial(r.deps, { prepareDate: "2026-09-06" })).toEqual({
      state: "invalid_manual_date",
    });
  });
  it("cannot publish if mode changes to publish between the settings check and claim", async () => {
    const r = rig("publish");
    await runEditorial(r.deps, { prepareDate: "2026-09-07" });
    expect(r.stored.state).toBe("skipped");
    expect(r.calls).not.toContain("generate");
    expect(r.calls).not.toContain("submit");
  });
  it("respects the durable claim's exhausted, active or completed outcome", async () => {
    const r = rig();
    r.deps.now = () => new Date("2026-09-06T01:00:00Z");
    r.deps.repository.claim = async () => null;
    expect(await runEditorial(r.deps, { prepareDate: "2026-09-05" })).toEqual({
      state: "idle",
      date: "2026-09-05",
    });
    expect(r.calls).toEqual([]);
  });
});
