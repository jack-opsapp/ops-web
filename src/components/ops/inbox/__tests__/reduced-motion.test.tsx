import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const useReducedMotionMock = vi.fn();

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    useReducedMotion: () => useReducedMotionMock(),
  };
});

import {
  useReducedInboxMotion,
  inboxRailVariants,
  inboxRailReducedVariants,
  milestonePulseVariants,
  milestonePulseReducedVariants,
} from "@/lib/utils/motion";

beforeEach(() => {
  useReducedMotionMock.mockReset();
});

describe("useReducedInboxMotion", () => {
  it("returns full variants when reduced motion is OFF", () => {
    useReducedMotionMock.mockReturnValue(false);
    const { result } = renderHook(() => useReducedInboxMotion());
    expect(result.current.reduced).toBe(false);
    expect(result.current.rail).toBe(inboxRailVariants);
    expect(result.current.milestone).toBe(milestonePulseVariants);
  });

  it("returns reduced variants when reduced motion is ON", () => {
    useReducedMotionMock.mockReturnValue(true);
    const { result } = renderHook(() => useReducedInboxMotion());
    expect(result.current.reduced).toBe(true);
    expect(result.current.rail).toBe(inboxRailReducedVariants);
    expect(result.current.milestone).toBe(milestonePulseReducedVariants);
  });

  it("composerFade is the same opacity-only variant in both modes", () => {
    useReducedMotionMock.mockReturnValue(false);
    const off = renderHook(() => useReducedInboxMotion()).result.current.composerFade;
    useReducedMotionMock.mockReturnValue(true);
    const on = renderHook(() => useReducedInboxMotion()).result.current.composerFade;
    expect(off).toBe(on);
  });
});
