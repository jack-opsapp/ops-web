import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { ModePill } from "@/components/ops/projects/workspace/shell/mode-pill";

// `ModePill` — VIEWING / EDITING / CREATING badge sat in the title bar.
// Viewing reads neutral (the workspace is at rest). Editing tints tan
// (warning — unsaved change is in flight). Creating tints accent (the
// workspace is in a generative state). Editing + creating BOTH pulse
// 1.6s ease-in-out infinite, opacity 1→0.45→1; viewing does not.
//
// We test by mocking `useReducedMotion` per case so the pulse
// suppression path is verified deterministically.

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    useReducedMotion: vi.fn(() => false),
  };
});

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({ t: (k: string) => k }),
}));

import { useReducedMotion } from "framer-motion";

describe("<ModePill>", () => {
  beforeEach(() => {
    vi.mocked(useReducedMotion).mockReturnValue(false);
  });

  it("renders the mode label uppercase + tracked", () => {
    render(<ModePill mode="viewing" />);
    // ModePill resolves the label via useDictionary — the test mock
    // returns the key string, so we assert on the i18n key rather than
    // the literal "VIEWING". The Mono atom still enforces uppercase.
    expect(screen.getByText("mode.viewing")).toBeInTheDocument();
  });

  it.each(["viewing", "editing", "creating"] as const)(
    "renders the dot + label for mode=%s",
    (mode) => {
      render(<ModePill mode={mode} />);
      expect(screen.getByText(`mode.${mode}`)).toBeInTheDocument();
      // Each pill has a leading status dot — easy DOM marker.
      expect(screen.getByTestId(`mode-pill-dot-${mode}`)).toBeInTheDocument();
    },
  );

  it("viewing variant uses neutral white-alpha background + text-2 colour", () => {
    render(<ModePill mode="viewing" />);
    const pill = screen.getByTestId("mode-pill-viewing");
    expect(pill.className).toContain("bg-[var(--surface-hover)]");
    expect(pill.className).toContain("text-text-2");
  });

  it("editing variant uses tan-soft background + tan text + tan dot", () => {
    render(<ModePill mode="editing" />);
    const pill = screen.getByTestId("mode-pill-editing");
    expect(pill.className).toContain("bg-[var(--tan-soft)]");
    expect(pill.className).toContain("text-[var(--tan)]");
    const dot = screen.getByTestId("mode-pill-dot-editing");
    expect(dot.className).toContain("bg-[var(--tan)]");
  });

  it("creating variant uses olive-soft background + olive text + olive dot", () => {
    render(<ModePill mode="creating" />);
    const pill = screen.getByTestId("mode-pill-creating");
    // CREATING is the "go" / generative state, tinted with the OLIVE earth
    // tone — NOT the accent. This keeps the pill family on earth tones
    // (viewing = neutral, editing = tan, creating = olive). --olive-soft is
    // the brand-wide 12% 'soft' tier, matching the editing pill's --tan-soft.
    expect(pill.className).toContain("bg-[var(--olive-soft)]");
    expect(pill.className).toContain("text-[var(--olive)]");
    const dot = screen.getByTestId("mode-pill-dot-creating");
    expect(dot.className).toContain("bg-olive");
  });

  it("uses chip radius (4px), 9.5px font-mono, tracking 0.16em uppercase", () => {
    render(<ModePill mode="viewing" />);
    const pill = screen.getByTestId("mode-pill-viewing");
    expect(pill).toHaveClass("rounded-chip");
    expect(pill).toHaveClass("font-mono");
    expect(pill).toHaveClass("uppercase");
    expect(pill.className).toContain("tracking-[0.16em]");
    expect(pill.className).toContain("text-[9.5px]");
  });

  describe("pulse animation", () => {
    it("editing pulses (data-pulsing=true)", () => {
      render(<ModePill mode="editing" />);
      expect(screen.getByTestId("mode-pill-editing")).toHaveAttribute(
        "data-pulsing",
        "true",
      );
    });

    it("creating pulses (data-pulsing=true)", () => {
      render(<ModePill mode="creating" />);
      expect(screen.getByTestId("mode-pill-creating")).toHaveAttribute(
        "data-pulsing",
        "true",
      );
    });

    it("viewing does NOT pulse", () => {
      render(<ModePill mode="viewing" />);
      expect(screen.getByTestId("mode-pill-viewing")).toHaveAttribute(
        "data-pulsing",
        "false",
      );
    });

    it("reduced-motion suppresses the pulse for editing", () => {
      vi.mocked(useReducedMotion).mockReturnValue(true);
      render(<ModePill mode="editing" />);
      expect(screen.getByTestId("mode-pill-editing")).toHaveAttribute(
        "data-pulsing",
        "false",
      );
    });

    it("reduced-motion suppresses the pulse for creating", () => {
      vi.mocked(useReducedMotion).mockReturnValue(true);
      render(<ModePill mode="creating" />);
      expect(screen.getByTestId("mode-pill-creating")).toHaveAttribute(
        "data-pulsing",
        "false",
      );
    });
  });
});
