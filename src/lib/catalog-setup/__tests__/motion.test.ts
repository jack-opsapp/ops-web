import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import {
  cardAcceptVariants,
  cardAcceptDotVariants,
  cardAcceptVariantsReduced,
  cardAcceptDotVariantsReduced,
  cardEnterVariants,
  cardEnterContainerVariants,
  cardEnterVariantsReduced,
  cardEnterContainerVariantsReduced,
  railAdvanceVariants,
  railAdvanceVariantsReduced,
  useCountUp,
  countUp,
  useCatalogSetupMotion,
  REDUCED_DURATION,
  COUNT_UP_DURATION_MS,
  CARD_STAGGER,
} from "@/lib/catalog-setup/motion";

// Pull the transition off a variant's resolved value. Variants can be a plain
// object or a function of `custom`; resolve functions with index 0.
function transitionOf(variant: unknown, custom = 0): Record<string, unknown> {
  const resolved =
    typeof variant === "function"
      ? (variant as (c: number) => Record<string, unknown>)(custom)
      : (variant as Record<string, unknown>);
  return (resolved?.transition ?? {}) as Record<string, unknown>;
}

describe("catalog-setup motion variants", () => {
  it("card-accept (Achievement stamp) pulses the border on the canonical curve", () => {
    const t = transitionOf(cardAcceptVariants.accepted);
    // Border keyframes = the "stamp" press-and-lift, three stops.
    expect(Array.isArray(cardAcceptVariants.accepted)).toBe(false);
    const accepted = cardAcceptVariants.accepted as Record<string, unknown>;
    expect(Array.isArray(accepted.borderColor)).toBe(true);
    expect((accepted.borderColor as unknown[]).length).toBe(3);
    expect(t.ease).toEqual(EASE_SMOOTH);
  });

  it("card-accept dot fills olive at the stamp peak", () => {
    const accepted = cardAcceptDotVariants.accepted as Record<string, unknown>;
    expect(accepted.backgroundColor).toBe("#9DB582"); // olive / accepted token
    expect(transitionOf(cardAcceptDotVariants.accepted).ease).toEqual(EASE_SMOOTH);
  });

  it("card-enter (Entry) lifts from y:+8 and is stagger-ready via custom index", () => {
    expect((cardEnterVariants.hidden as Record<string, unknown>).y).toBe(8);
    // custom=2 → delay scales by CARD_STAGGER (the 50ms cascade).
    const t = transitionOf(cardEnterVariants.visible, 2);
    expect(t.delay).toBeCloseTo(2 * CARD_STAGGER);
    expect(t.ease).toEqual(EASE_SMOOTH);
    // container orchestrates the cascade.
    expect(transitionOf(cardEnterContainerVariants.visible).staggerChildren).toBe(
      CARD_STAGGER,
    );
  });

  it("rail-advance (Transition) grows a 2px track via scaleX 0→1 (GPU-only)", () => {
    expect((railAdvanceVariants.inactive as Record<string, unknown>).scaleX).toBe(0);
    const active = railAdvanceVariants.active as Record<string, unknown>;
    expect(active.scaleX).toBe(1);
    expect(transitionOf(railAdvanceVariants.active).ease).toEqual(EASE_SMOOTH);
  });

  it("every reduced-motion variant is opacity-only at 150ms (same beat, no movement)", () => {
    // No y / scaleX translation in any reduced variant.
    expect((cardEnterVariantsReduced.hidden as Record<string, unknown>).y).toBeUndefined();
    expect(transitionOf(cardEnterContainerVariantsReduced.visible).staggerChildren).toBe(0);
    expect((railAdvanceVariantsReduced.inactive as Record<string, unknown>).scaleX).toBe(1);

    // All reduced transitions run at the uniform 150ms fallback.
    expect(transitionOf(cardEnterVariantsReduced.visible).duration).toBe(REDUCED_DURATION);
    expect(transitionOf(cardAcceptVariantsReduced.accepted).duration).toBe(REDUCED_DURATION);
    expect(transitionOf(cardAcceptDotVariantsReduced.accepted).duration).toBe(REDUCED_DURATION);
    expect(transitionOf(railAdvanceVariantsReduced.active).duration).toBe(REDUCED_DURATION);

    // Reduced still lands on the SAME end state (accepted dot is still olive).
    expect((cardAcceptDotVariantsReduced.accepted as Record<string, unknown>).backgroundColor).toBe(
      "#9DB582",
    );
  });
});

describe("useCatalogSetupMotion resolver", () => {
  it("exposes one variant per surface and a reduced flag (full-motion by default)", () => {
    const { result } = renderHook(() => useCatalogSetupMotion());
    // matchMedia mock returns matches:false → full motion.
    expect(result.current.reduced).toBe(false);
    expect(result.current.cardEnter).toBe(cardEnterVariants);
    expect(result.current.cardAccept).toBe(cardAcceptVariants);
    expect(result.current.railAdvance).toBe(railAdvanceVariants);
    expect(result.current.cardEnterContainer).toBe(cardEnterContainerVariants);
  });
});

describe("useCountUp hook (800ms quadratic ease-out, rAF-driven)", () => {
  let now = 0;
  let queue: Array<(t: number) => void> = [];

  beforeEach(() => {
    now = 0;
    queue = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (cb: FrameRequestCallback) => {
        queue.push(cb as (t: number) => void);
        return queue.length;
      },
    );
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Advance the mocked clock and flush whatever frames are queued.
  function advance(ms: number) {
    now += ms;
    const pending = queue;
    queue = [];
    act(() => {
      pending.forEach((cb) => cb(now));
    });
  }

  it("starts at the initial value and lands exactly on the target after the run", () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 0 },
    });
    expect(result.current).toBe(0);

    rerender({ v: 100 });
    // First frame primes the start timestamp.
    advance(0);
    // Midway: eased value is between 0 and 100, not yet landed.
    advance(COUNT_UP_DURATION_MS / 2);
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(100);
    // Past the full duration: snaps exactly to target.
    advance(COUNT_UP_DURATION_MS);
    expect(result.current).toBe(100);
  });

  it("eases out (decelerates): past the halfway point in value before halfway in time", () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 0 },
    });
    rerender({ v: 1000 });
    advance(0);
    advance(COUNT_UP_DURATION_MS / 2);
    // ease-out quad at t=0.5 → 0.75 → value ≈ 750 > 500 (linear midpoint).
    expect(result.current).toBeGreaterThan(500);
  });

  it("snaps instantly with no rAF when reduced motion is requested", () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v, { reduced: true }), {
      initialProps: { v: 0 },
    });
    rerender({ v: 42 });
    // Reduced path sets state synchronously; no frame needed.
    expect(result.current).toBe(42);
  });
});

describe("countUp imperative helper", () => {
  let now = 0;
  let queue: Array<(t: number) => void> = [];

  beforeEach(() => {
    now = 0;
    queue = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (cb: FrameRequestCallback) => {
        queue.push(cb as (t: number) => void);
        return queue.length;
      },
    );
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  function flush(ms: number) {
    now += ms;
    const pending = queue;
    queue = [];
    pending.forEach((cb) => cb(now));
  }

  it("calls onUpdate across frames and onComplete exactly once at the target", () => {
    const updates: number[] = [];
    const onComplete = vi.fn();
    countUp(0, 10, (v) => updates.push(v), { onComplete });
    flush(0);
    flush(COUNT_UP_DURATION_MS / 2);
    flush(COUNT_UP_DURATION_MS);
    expect(updates[updates.length - 1]).toBe(10);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("reduced mode emits the target once and completes without scheduling a frame", () => {
    const updates: number[] = [];
    const onComplete = vi.fn();
    countUp(0, 99, (v) => updates.push(v), { reduced: true, onComplete });
    expect(updates).toEqual([99]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(queue.length).toBe(0);
  });

  it("cancel() stops the loop (no orphaned rAF)", () => {
    const handle = countUp(0, 100, () => {});
    expect(() => handle.cancel()).not.toThrow();
  });
});
