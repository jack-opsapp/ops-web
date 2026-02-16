/**
 * Vitest Global Test Setup
 *
 * Configures the test environment with:
 * - Jest DOM matchers for DOM assertions
 * - MSW server lifecycle (start, reset, close)
 * - Browser API mocks (matchMedia, IntersectionObserver, ResizeObserver)
 * - Console error suppression for known React warnings
 */

import "@testing-library/jest-dom/vitest";
import { server } from "./mocks/server";
import { beforeAll, afterEach, afterAll, vi } from "vitest";

// ─── MSW Server Lifecycle ───────────────────────────────────────────────────

beforeAll(() => {
  server.listen({
    onUnhandledRequest: "warn",
  });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// ─── Mock: window.matchMedia ────────────────────────────────────────────────

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ─── Mock: IntersectionObserver ─────────────────────────────────────────────

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "0px";
  readonly thresholds: ReadonlyArray<number> = [0];

  private callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {
    this.callback = callback;
  }

  observe(_target: Element): void {
    // Immediately trigger with isIntersecting: true for simpler tests
    const entry: IntersectionObserverEntry = {
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRatio: 1,
      intersectionRect: {} as DOMRectReadOnly,
      isIntersecting: true,
      rootBounds: null,
      target: _target,
      time: Date.now(),
    };
    this.callback([entry], this);
  }

  unobserve(_target: Element): void {
    // No-op
  }

  disconnect(): void {
    // No-op
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

Object.defineProperty(global, "IntersectionObserver", {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

// ─── Mock: ResizeObserver ───────────────────────────────────────────────────

class MockResizeObserver implements ResizeObserver {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    // Trigger with a default size entry
    const entry: ResizeObserverEntry = {
      target,
      contentRect: {
        x: 0,
        y: 0,
        width: 1024,
        height: 768,
        top: 0,
        right: 1024,
        bottom: 768,
        left: 0,
        toJSON: () => ({}),
      },
      borderBoxSize: [{ blockSize: 768, inlineSize: 1024 }],
      contentBoxSize: [{ blockSize: 768, inlineSize: 1024 }],
      devicePixelContentBoxSize: [{ blockSize: 768, inlineSize: 1024 }],
    };
    this.callback([entry], this);
  }

  unobserve(_target: Element): void {
    // No-op
  }

  disconnect(): void {
    // No-op
  }
}

Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  configurable: true,
  value: MockResizeObserver,
});

Object.defineProperty(global, "ResizeObserver", {
  writable: true,
  configurable: true,
  value: MockResizeObserver,
});

// ─── Mock: scrollTo ─────────────────────────────────────────────────────────

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: vi.fn(),
});

// ─── Mock: URL.createObjectURL / revokeObjectURL ────────────────────────────

if (typeof URL.createObjectURL === "undefined") {
  Object.defineProperty(URL, "createObjectURL", {
    writable: true,
    value: vi.fn(() => "blob:http://localhost:3000/mock-blob-url"),
  });
}

if (typeof URL.revokeObjectURL === "undefined") {
  Object.defineProperty(URL, "revokeObjectURL", {
    writable: true,
    value: vi.fn(),
  });
}

// ─── Suppress Known React Console Warnings ──────────────────────────────────

const originalConsoleError = console.error;
const SUPPRESSED_PATTERNS = [
  // React 19 ref warnings during testing
  /Warning: Function components cannot be given refs/,
  // React DOM nesting warnings from testing library
  /Warning: validateDOMNesting/,
  // React act() warnings that are noisy in tests
  /Warning:.*not wrapped in act/,
  // Next.js router warnings in test context
  /NextRouter was not mounted/,
  // Radix UI portal warnings in jsdom
  /Missing required context/,
  // React 19 useId warnings in test
  /useId/,
];

console.error = (...args: unknown[]) => {
  const message = typeof args[0] === "string" ? args[0] : String(args[0]);
  const isSuppressed = SUPPRESSED_PATTERNS.some((pattern) => pattern.test(message));
  if (!isSuppressed) {
    originalConsoleError.apply(console, args);
  }
};
