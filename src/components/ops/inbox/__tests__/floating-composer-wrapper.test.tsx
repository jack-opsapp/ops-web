import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FloatingComposerWrapper } from "../composer/floating-composer-wrapper";

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>(
    "framer-motion",
  );
  return {
    ...actual,
    // Strip motion props from the rendered element so we can assert on
    // class names without framer-motion's animation harness.
    useReducedMotion: () => false,
  };
});

describe("<FloatingComposerWrapper>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mounts the wrapper at z-1550 inside an absolute, pointer-events-none shell", () => {
    render(
      <FloatingComposerWrapper show>
        <div data-testid="composer-child">composer body</div>
      </FloatingComposerWrapper>,
    );
    const wrapper = screen.getByTestId("floating-composer-wrapper");
    const cls = wrapper.className;
    expect(cls).toMatch(/absolute/);
    expect(cls).toMatch(/z-\[1550\]/);
    expect(cls).toMatch(/pointer-events-none/);
    expect(cls).toMatch(/bottom-3/);
    expect(cls).toMatch(/px-6/);
  });

  it("renders children inside a pointer-events-auto inner panel with a max width cap", () => {
    render(
      <FloatingComposerWrapper show>
        <div data-testid="composer-child">composer body</div>
      </FloatingComposerWrapper>,
    );
    const child = screen.getByTestId("composer-child");
    const inner = child.parentElement;
    expect(inner).not.toBeNull();
    expect(inner?.className ?? "").toMatch(/pointer-events-auto/);
    expect(inner?.className ?? "").toMatch(/max-w-\[760px\]/);
  });

  it("does not render the wrapper when show is false", () => {
    render(
      <FloatingComposerWrapper show={false}>
        <div data-testid="composer-child">composer body</div>
      </FloatingComposerWrapper>,
    );
    expect(
      screen.queryByTestId("floating-composer-wrapper"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("composer-child")).not.toBeInTheDocument();
  });

  it("forwards className to the outer motion wrapper", () => {
    render(
      <FloatingComposerWrapper show className="custom-extra-class">
        <div data-testid="composer-child">composer body</div>
      </FloatingComposerWrapper>,
    );
    const wrapper = screen.getByTestId("floating-composer-wrapper");
    expect(wrapper.className).toMatch(/custom-extra-class/);
  });
});
