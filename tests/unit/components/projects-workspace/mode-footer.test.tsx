import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import {
  ModeFooter,
  type ModeFooterConfig,
} from "@/components/ops/projects/workspace/shell/mode-footer";

// Phase 12.3 — the footer wraps each button slot in a motion.div with
// layout={!reducedMotion}. We mock useReducedMotion default to false so
// the FLIP path is exercised. A nested describe overrides per case.
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    useReducedMotion: vi.fn(() => false),
  };
});

import { useReducedMotion } from "framer-motion";

// `ModeFooter` — bottom action bar of the workspace. Slot order is
// strict: destructive | meta | spacer | secondary[] | ghost | primary.
// The bar itself is dense glass with a hairline top border. Each mode
// (viewing / editing / creating) gets its own config of which buttons
// to render where; this component is just the slot layout + a render
// guard that fails fast if a config tries to declare > 1 primary.

describe("<ModeFooter>", () => {
  const baseConfig: ModeFooterConfig = {
    primary: { label: "SAVE", onClick: vi.fn() },
    secondary: [],
  };

  it("renders padding 10/18 + top hairline + dense backdrop", () => {
    render(<ModeFooter config={baseConfig} />);
    const footer = screen.getByTestId("mode-footer");
    expect(footer.className).toContain("py-[10px]");
    expect(footer.className).toContain("px-[18px]");
    expect(footer).toHaveClass("border-t");
    expect(footer).toHaveClass("border-glass-border");
    // --scrim-input-bg = rgba(0,0,0,0.45); consolidated from 0.42 per
    // design-token cleanup 2026-05-07 (visual delta undetectable).
    expect(footer.className).toContain("bg-[var(--scrim-input-bg)]");
    expect(footer.className).toContain("backdrop-blur-[12px]");
  });

  it("renders the primary button at the right edge", () => {
    render(<ModeFooter config={baseConfig} />);
    expect(screen.getByRole("button", { name: "SAVE" })).toBeInTheDocument();
  });

  it("renders destructive on the far left when provided", () => {
    const onArchive = vi.fn();
    render(
      <ModeFooter
        config={{ ...baseConfig, destructive: { label: "ARCHIVE", onClick: onArchive } }}
      />,
    );
    const archive = screen.getByRole("button", { name: "ARCHIVE" });
    // Destructive uses Btn variant=destructive — rose tone tokens.
    expect(archive.className).toContain("text-[var(--rose)]");
  });

  it("renders the meta slot between destructive and the spacer", () => {
    render(
      <ModeFooter config={{ ...baseConfig, meta: <span data-testid="meta">CREATED 2026-04-12</span> }} />,
    );
    expect(screen.getByTestId("meta")).toBeInTheDocument();
  });

  it("renders multiple secondary buttons in declared order", () => {
    render(
      <ModeFooter
        config={{
          ...baseConfig,
          secondary: [
            { label: "RESET", onClick: vi.fn() },
            { label: "DUPLICATE", onClick: vi.fn() },
          ],
        }}
      />,
    );
    const buttons = screen.getAllByRole("button");
    const labels = buttons.map((b) => b.textContent);
    const resetIdx = labels.indexOf("RESET");
    const duplicateIdx = labels.indexOf("DUPLICATE");
    const saveIdx = labels.indexOf("SAVE");
    expect(resetIdx).toBeGreaterThan(-1);
    expect(duplicateIdx).toBeGreaterThan(resetIdx);
    expect(saveIdx).toBeGreaterThan(duplicateIdx);
  });

  it("renders the ghost slot before the primary (right-side group)", () => {
    render(
      <ModeFooter
        config={{
          ...baseConfig,
          ghost: { label: "CANCEL", onClick: vi.fn() },
        }}
      />,
    );
    const buttons = screen.getAllByRole("button");
    const labels = buttons.map((b) => b.textContent);
    const cancelIdx = labels.indexOf("CANCEL");
    const saveIdx = labels.indexOf("SAVE");
    expect(cancelIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeGreaterThan(cancelIdx);
  });

  it("can omit primary entirely (viewing mode has no primary CTA)", () => {
    render(<ModeFooter config={{ secondary: [] }} />);
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("primary button uses primary variant tokens (outlined accent)", () => {
    render(<ModeFooter config={baseConfig} />);
    const primary = screen.getByRole("button", { name: "SAVE" });
    expect(primary).toHaveClass("text-ops-accent");
    expect(primary).toHaveClass("border-ops-accent");
  });

  it("secondary buttons use secondary variant tokens", () => {
    render(
      <ModeFooter
        config={{
          ...baseConfig,
          secondary: [{ label: "RESET", onClick: vi.fn() }],
        }}
      />,
    );
    const reset = screen.getByRole("button", { name: "RESET" });
    expect(reset).toHaveClass("text-text-2");
    expect(reset).toHaveClass("border-glass-border");
  });

  it("ghost button uses ghost variant tokens (no border)", () => {
    render(
      <ModeFooter
        config={{
          ...baseConfig,
          ghost: { label: "CANCEL", onClick: vi.fn() },
        }}
      />,
    );
    const ghost = screen.getByRole("button", { name: "CANCEL" });
    expect(ghost).toHaveClass("border-transparent");
  });

  it("primary onClick fires when clicked", async () => {
    const onClick = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    render(
      <ModeFooter config={{ secondary: [], primary: { label: "SAVE", onClick } }} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "SAVE" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("disabled primary is not clickable", async () => {
    const onClick = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    render(
      <ModeFooter
        config={{
          secondary: [],
          primary: { label: "SAVE", onClick, disabled: true },
        }}
      />,
    );
    const btn = screen.getByRole("button", { name: "SAVE" });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  // Phase 9.3 — primary/secondary actions can opt into native form-submit
  // behaviour by declaring `type: "submit"` + `form: <id>`. The workspace
  // container uses this to wire SAVE → the composer's react-hook-form
  // without crossing the body/footer boundary with a callback ref.
  it("primary forwards type+form attributes for form-submit binding", () => {
    render(
      <ModeFooter
        config={{
          secondary: [],
          primary: {
            label: "SAVE",
            onClick: vi.fn(),
            type: "submit",
            form: "edit-create-form",
          },
        }}
      />,
    );
    const btn = screen.getByRole("button", { name: "SAVE" });
    expect(btn).toHaveAttribute("type", "submit");
    expect(btn).toHaveAttribute("form", "edit-create-form");
  });

  it("secondary forwards type+form attributes the same way", () => {
    render(
      <ModeFooter
        config={{
          secondary: [
            {
              label: "SUBMIT-EXTRA",
              onClick: vi.fn(),
              type: "submit",
              form: "x",
            },
          ],
        }}
      />,
    );
    const btn = screen.getByRole("button", { name: "SUBMIT-EXTRA" });
    expect(btn).toHaveAttribute("type", "submit");
    expect(btn).toHaveAttribute("form", "x");
  });

  // Phase 12.3 — FLIP layout animation. Each button slot is a motion.div
  // wrapper carrying a stable test id so we can assert the slots are
  // present per mode and animate through layout transitions when modes
  // swap. Reduced motion collapses to opacity-only / 0ms.
  describe("FLIP layout animation (Phase 12.3)", () => {
    it("renders a stable per-button slot wrapper for primary", () => {
      render(
        <ModeFooter
          config={{
            secondary: [],
            primary: { label: "SAVE", onClick: vi.fn() },
          }}
        />,
      );
      expect(
        screen.getByTestId("mode-footer-slot-primary:SAVE"),
      ).toBeInTheDocument();
    });

    it("slot wrappers swap when the primary action changes label", async () => {
      const { rerender } = render(
        <ModeFooter
          config={{
            secondary: [],
            primary: { label: "EDIT", onClick: vi.fn() },
          }}
        />,
      );
      expect(
        screen.getByTestId("mode-footer-slot-primary:EDIT"),
      ).toBeInTheDocument();

      rerender(
        <ModeFooter
          config={{
            secondary: [],
            ghost: { label: "CANCEL", onClick: vi.fn() },
            primary: { label: "SAVE", onClick: vi.fn() },
          }}
        />,
      );
      // AnimatePresence keeps the outgoing slot mounted during exit
      // animation; the new slot mounts immediately (default mode, not
      // wait). Wait for both: new slot present, old slot gone.
      expect(
        screen.getByTestId("mode-footer-slot-primary:SAVE"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("mode-footer-slot-ghost:CANCEL"),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.queryByTestId("mode-footer-slot-primary:EDIT"),
        ).not.toBeInTheDocument();
      });
    });

    it("destructive slot only renders when destructive action is supplied", () => {
      const { rerender } = render(
        <ModeFooter
          config={{
            secondary: [],
            primary: { label: "SAVE", onClick: vi.fn() },
          }}
        />,
      );
      expect(
        screen.queryByTestId(/^mode-footer-slot-destructive:/),
      ).not.toBeInTheDocument();

      rerender(
        <ModeFooter
          config={{
            secondary: [],
            destructive: { label: "ARCHIVE", onClick: vi.fn() },
            primary: { label: "SAVE", onClick: vi.fn() },
          }}
        />,
      );
      expect(
        screen.getByTestId("mode-footer-slot-destructive:ARCHIVE"),
      ).toBeInTheDocument();
    });

    it("reduced motion still renders all slots (opt-out of layout animation)", () => {
      vi.mocked(useReducedMotion).mockReturnValue(true);
      render(
        <ModeFooter
          config={{
            secondary: [{ label: "DISCARD", onClick: vi.fn() }],
            ghost: { label: "CANCEL", onClick: vi.fn() },
            primary: { label: "SAVE", onClick: vi.fn() },
            destructive: { label: "ARCHIVE", onClick: vi.fn() },
          }}
        />,
      );
      expect(
        screen.getByTestId("mode-footer-slot-destructive:ARCHIVE"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("mode-footer-slot-secondary:DISCARD"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("mode-footer-slot-ghost:CANCEL"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("mode-footer-slot-primary:SAVE"),
      ).toBeInTheDocument();
      vi.mocked(useReducedMotion).mockReturnValue(false);
    });
  });
});
