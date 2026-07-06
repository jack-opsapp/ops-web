import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";

// Keep `motion` real (so the reduced-motion fallback's `motion.span` renders a
// real span, on both the server and the client) while controlling the motion
// preference per test. Mirrors the mode-footer test convention.
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    useReducedMotion: vi.fn(() => false),
  };
});

import { useReducedMotion } from "framer-motion";
import { LogoLoader } from "@/components/brand/logo-loader";

const mockUseReducedMotion = vi.mocked(useReducedMotion);

// `<LogoLoader>` is the auth-gate loading state. It embeds the v2 design-system
// loader in an iframe and, for `prefers-reduced-motion`, swaps to a static
// lockup. The server can't know the client's motion preference, so SSR must
// always emit the iframe — the reduced-motion swap has to happen *after*
// hydration or the server HTML (iframe) and the first client render (span)
// disagree and React throws a hydration mismatch on every auth-gated page load.
describe("<LogoLoader>", () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
  });

  it("hydrates without a mismatch when the client prefers reduced motion", () => {
    // Server render: no matchMedia on the server, so framer-motion reports
    // motion allowed and SSR emits the iframe.
    mockUseReducedMotion.mockReturnValue(false);
    const serverHTML = renderToString(<LogoLoader />);
    expect(serverHTML).toContain("v2-loader/index.html"); // guard: SSR really is the iframe

    const container = document.createElement("div");
    container.innerHTML = serverHTML;
    document.body.appendChild(container);

    // The client prefers reduced motion.
    mockUseReducedMotion.mockReturnValue(true);

    // Hydration mismatches are *recoverable* errors in React — captured here so
    // the assertion doesn't depend on console interception.
    const recoverableErrors: string[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    act(() => {
      root = hydrateRoot(container, <LogoLoader />, {
        onRecoverableError: (error) => recoverableErrors.push(String(error)),
      });
    });

    const hydrationErrors = recoverableErrors.filter((e) => /hydrat|match/i.test(e));

    act(() => root?.unmount());
    container.remove();

    expect(hydrationErrors).toEqual([]);
  });

  it("emits the SSR-safe iframe on the server even when reduced motion is preferred", () => {
    // The server render must not depend on the motion preference — if it can
    // emit the static lockup, the first client paint can disagree with it.
    mockUseReducedMotion.mockReturnValue(true);
    const html = renderToStaticMarkup(<LogoLoader />);
    expect(html).toContain("<iframe");
    expect(html).toContain("v2-loader/index.html");
  });

  it("shows the static lockup for reduced-motion users after mount", () => {
    mockUseReducedMotion.mockReturnValue(true);
    const { container } = render(<LogoLoader />);
    // After mount + effects flush, the accessible static lockup is shown and
    // the iframe is gone.
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector("iframe")).not.toBeInTheDocument();
  });

  it("renders the animated iframe loader when motion is allowed", () => {
    mockUseReducedMotion.mockReturnValue(false);
    const { container } = render(<LogoLoader />);
    const iframe = container.querySelector("iframe");
    expect(iframe).toBeInTheDocument();
    expect(iframe?.getAttribute("src")).toContain("v2-loader/index.html");
  });
});
