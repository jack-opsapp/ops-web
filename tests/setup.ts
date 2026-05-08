/**
 * Vitest Global Test Setup
 *
 * Configures the test environment with:
 * - Jest DOM matchers for DOM assertions
 * - MSW server lifecycle (start, reset, close)
 * - Browser API mocks (matchMedia, IntersectionObserver, ResizeObserver)
 * - Console error suppression for known React warnings
 * - Stub Firebase env so `firebase/config.ts`'s top-level
 *   `auth = getFirebaseAuth()` invocation doesn't blow up under jsdom
 *   for tests that import the auth provider transitively (auth.test.tsx,
 *   projects.test.tsx). Firebase v11 throws `auth/invalid-api-key`
 *   before any test runs if the apiKey is undefined; a non-empty stub
 *   value satisfies the constructor without making any network calls.
 */

// MUST run before any imports that touch firebase/config — module-load
// order matters here; the env reads happen at the top of config.ts.
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??= "test-api-key";
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??= "test.firebaseapp.com";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= "test-project";
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??= "test.appspot.com";
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ??= "0";
process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??= "1:0:web:test";

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

// ─── Polyfill: localStorage / sessionStorage ────────────────────────────────
//
// jsdom 25 + Vitest 2's worker pool gives us a `localStorage` that exists as
// an `object` but is missing the `setItem`/`getItem`/`removeItem` methods
// (its prototype is plain Object, not Storage). This breaks Zustand's
// persist middleware ("storage.setItem is not a function") which in turn
// blows up every integration test that touches the auth store. Install a
// fresh in-memory Storage shim before any test or component code runs.

class InMemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(window, name, {
    configurable: true,
    writable: false,
    value: new InMemoryStorage(),
  });
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: false,
    value: (window as unknown as Record<string, Storage>)[name],
  });
}

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

// ─── Polyfill: Pointer Capture + scrollIntoView (Radix popper testing) ─────
//
// jsdom 25 doesn't implement `Element.prototype.hasPointerCapture` /
// `setPointerCapture` / `releasePointerCapture` or `scrollIntoView`.
// Radix's Select / Dropdown / Popover internals call all of them when a
// trigger is clicked. Without these stubs, every Radix-based component
// test throws `target.hasPointerCapture is not a function` the moment the
// user opens the menu.
//
// jsdom-typed-void shim so the assertions below are lossless.

if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = function () {
      return false;
    };
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = function () {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = function () {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
}

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
