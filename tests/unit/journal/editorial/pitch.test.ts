import { describe, expect, it } from "vitest";
import { JournalPitchError, prepareJournalPitch } from "@/lib/journal/editorial/pitch";
import { SIGNAL_NEWS, SIGNAL_THREAD, SIGNAL_VIDEO, pitchContext, signalRow, validPitch } from "./fixtures";

const NOW = new Date("2026-09-13T13:30:00Z");

function rejection(raw: unknown, ctx = pitchContext()) {
  try {
    prepareJournalPitch(raw, { ...ctx, now: NOW });
  } catch (error) {
    if (error instanceof JournalPitchError) return { code: error.code, issues: error.issues };
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("journal pitch", () => {
  it("keeps the pitch and freezes each cited signal as the radar saw it", () => {
    const pitch = prepareJournalPitch(validPitch(), { ...pitchContext(), now: NOW });
    expect(pitch.headline).toBe("YOUR NEW GUY QUIT BEFORE LUNCH");
    expect(pitch.signals).toHaveLength(3);
    expect(pitch.signals[0]).toEqual({
      id: SIGNAL_VIDEO,
      sphere: "trades",
      source: "Tommy Mello",
      kind: "video",
      title: "Why your best tech quits in the first year",
      url: "https://www.youtube.com/watch?v=abc123",
      summary: "Retention starts on day one.",
      published_at: "2026-09-10T15:00:00.000Z",
      age_days: 2.9,
      views: 48210,
      typical_views: 9400,
      momentum: 5.13,
      replies: null,
    });
    expect(pitch.radar_scanned_at).toBe("2026-09-13T12:09:00.000Z");
    expect(pitch.hooks_considered).toHaveLength(6);
    expect(pitch.runners_up).toHaveLength(2);
  });

  it("drops a repeated signal or search result instead of counting it twice", () => {
    const pitch = prepareJournalPitch(
      validPitch({
        signals: [SIGNAL_VIDEO, SIGNAL_VIDEO, SIGNAL_THREAD, SIGNAL_NEWS],
        chatter: [
          { url: "https://x.com/someone/status/1", shows: "An owner thread about helpers." },
          { url: "https://x.com/someone/status/1", shows: "The same thread again." },
        ],
      }),
      { ...pitchContext(), now: NOW }
    );
    expect(pitch.signals.map((signal) => signal.id)).toEqual([SIGNAL_VIDEO, SIGNAL_THREAD, SIGNAL_NEWS]);
    expect(pitch.chatter).toHaveLength(1);
  });

  it("rejects a malformed pitch with the exact paths", () => {
    const missing = rejection(validPitch({ angle: undefined, hooks_considered: [] }));
    expect(missing.code).toBe("SCHEMA_INVALID");
    expect(missing.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(["angle", "hooks_considered"]));
    expect(rejection(validPitch({ chatter: [{ url: "http://plain.example.com", shows: "x" }] })).code).toBe("SCHEMA_INVALID");
    expect(rejection(validPitch({ extra: true })).code).toBe("SCHEMA_INVALID");
  });

  it("keeps the pitch in plain sentences", () => {
    expect(rejection(validPitch({ angle: "Turnover is **decided** in week one." })).code).toBe("MARKUP_INVALID");
    const linked = rejection(validPitch({ why_now: "See https://www.youtube.com/watch?v=abc123 for the heat." }));
    expect(linked).toEqual({ code: "MARKUP_INVALID", issues: [{ path: "why_now", message: "plain sentences only; put the page in chatter or signals" }] });
  });

  it("holds the headline to the journal title rule and the hook to the brand voice", () => {
    expect(rejection(validPitch({ headline: "Your new guy quit before lunch" })).code).toBe("TITLE_FORMAT");
    expect(rejection(validPitch({ headline: "QUIT BEFORE LUNCH" })).code).toBe("TITLE_FORMAT");
    const voice = rejection(validPitch({ hook: "Every contractor has lost a helper by noon!" }));
    expect(voice.code).toBe("VOICE_REJECTED");
    expect(voice.issues.map((issue) => issue.message)).toEqual([
      '"contractor" is banned; say subtrades, the trades, crews, owner-operators or business owners',
      "no exclamation points",
    ]);
    expect(rejection(validPitch({ headline: "AI IS HIRING YOUR NEXT HELPER NOW" })).issues).toEqual([
      { path: "headline", message: "never lead with AI" },
    ]);
    expect(rejection(validPitch({ hook: "Yesterday he carried lumber until noon and never came back." })).code).toBe("STALE_FRAMING");
  });

  it("requires the heat to be observed: known radar signals, and enough evidence", () => {
    const unknown = rejection(validPitch(), pitchContext({ signals: new Map([[SIGNAL_VIDEO, signalRow()]]) }));
    expect(unknown.code).toBe("PITCH_SIGNAL_UNKNOWN");
    expect(unknown.issues.map((issue) => issue.path)).toEqual(["signals.1", "signals.2"]);

    const old = signalRow({ published_at: "2026-08-20T00:00:00.000Z" });
    expect(rejection(validPitch({ signals: [SIGNAL_VIDEO] }), pitchContext({ signals: new Map([[SIGNAL_VIDEO, old]]) })).code).toBe(
      "PITCH_SIGNAL_UNKNOWN"
    );

    expect(rejection(validPitch({ signals: [], chatter: [] })).issues).toEqual([
      { path: "signals", message: "cite at least one trend_signals id from the claim" },
    ]);
    expect(rejection(validPitch({ signals: [SIGNAL_VIDEO], chatter: [] })).code).toBe("PITCH_EVIDENCE");
  });

  it("lets search carry the evidence only when the radar holds nothing", () => {
    const chatter = [1, 2, 3].map((index) => ({ url: `https://www.reddit.com/r/Construction/comments/${index}/`, shows: "Owners on helpers quitting." }));
    const pitch = prepareJournalPitch(validPitch({ signals: [], chatter }), {
      ...pitchContext({ signals: new Map(), radarSignalsAvailable: 0 }),
      now: NOW,
    });
    expect(pitch.signals).toEqual([]);
    expect(pitch.chatter).toHaveLength(3);
  });

  it("requires real alternatives in the hook room and real runners-up", () => {
    const sameHooks = validPitch().hooks_considered.map((entry) => ({ ...entry, headline: "YOUR NEW GUY QUIT BEFORE LUNCH" }));
    expect(rejection(validPitch({ hooks_considered: sameHooks })).code).toBe("PITCH_HOOKS");
    expect(
      rejection(
        validPitch({
          runners_up: [
            { topic: "Why new hires quit in the first ninety days", why_not: "Same." },
            { topic: "Pricing small repair jobs", why_not: "Covered." },
          ],
        })
      ).issues
    ).toEqual([{ path: "runners_up.0.topic", message: "a runner-up is a different topic from the pick and from each other" }]);
  });

  it("refuses a headline that repeats a live post from the last year", () => {
    const ctx = pitchContext({
      livePosts: [{ title: "YOUR NEW GUY QUIT BEFORE LUNCH", published_at: "2026-03-01T12:00:00Z" }],
    });
    expect(rejection(validPitch(), ctx).code).toBe("DUPLICATE_TOPIC");
    const older = pitchContext({ livePosts: [{ title: "YOUR NEW GUY QUIT BEFORE LUNCH", published_at: "2025-06-01T12:00:00Z" }] });
    expect(prepareJournalPitch(validPitch(), { ...older, now: NOW }).headline).toBe("YOUR NEW GUY QUIT BEFORE LUNCH");
  });
});
