/**
 * Unit tests for src/lib/pmf/utm-capture.ts
 *
 * captureFirstTouchFromUrl is pure and tested in full.
 * readCookieFirstTouch / writeCookieFirstTouch / captureOnLanding touch
 * `document.cookie` and `window.location` — exercised via jsdom which the
 * vitest config already provides.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  captureFirstTouchFromUrl,
  readCookieFirstTouch,
  writeCookieFirstTouch,
  captureOnLanding,
  type FirstTouch,
} from "@/lib/pmf/utm-capture";

const COOKIE = "__ops_first_touch";

function clearCookie(): void {
  // Expire the cookie. jsdom honours the Path attribute.
  document.cookie = `${COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

describe("captureFirstTouchFromUrl", () => {
  it("extracts every UTM param + gclid + fbclid from a URL", () => {
    const url =
      "https://app.opsapp.co/signup?utm_source=google&utm_medium=cpc" +
      "&utm_campaign=spring&utm_content=ad1&utm_term=field+service" +
      "&gclid=Cj0KCQjw&fbclid=IwAR1";
    const touch = captureFirstTouchFromUrl(url, "https://google.com/");
    expect(touch).not.toBeNull();
    expect(touch!.utm_source).toBe("google");
    expect(touch!.utm_medium).toBe("cpc");
    expect(touch!.utm_campaign).toBe("spring");
    expect(touch!.utm_content).toBe("ad1");
    expect(touch!.utm_term).toBe("field service");
    expect(touch!.gclid).toBe("Cj0KCQjw");
    expect(touch!.fbclid).toBe("IwAR1");
  });

  it("returns referrer when provided", () => {
    const touch = captureFirstTouchFromUrl(
      "https://app.opsapp.co/?utm_source=newsletter",
      "https://blog.opsapp.co/post"
    );
    expect(touch!.referrer).toBe("https://blog.opsapp.co/post");
  });

  it("returns referrer = undefined when empty string passed", () => {
    const touch = captureFirstTouchFromUrl(
      "https://app.opsapp.co/?utm_source=newsletter",
      ""
    );
    expect(touch!.referrer).toBeUndefined();
  });

  it("handles URLs with no UTM params — sets landing_url + captured_at, leaves UTMs undefined", () => {
    const touch = captureFirstTouchFromUrl("https://app.opsapp.co/", "");
    expect(touch).not.toBeNull();
    expect(touch!.utm_source).toBeUndefined();
    expect(touch!.utm_medium).toBeUndefined();
    expect(touch!.utm_campaign).toBeUndefined();
    expect(touch!.utm_content).toBeUndefined();
    expect(touch!.utm_term).toBeUndefined();
    expect(touch!.gclid).toBeUndefined();
    expect(touch!.fbclid).toBeUndefined();
    expect(touch!.landing_url).toBe("https://app.opsapp.co/");
    expect(typeof touch!.captured_at).toBe("string");
    // Must round-trip through Date
    expect(new Date(touch!.captured_at).toISOString()).toBe(touch!.captured_at);
  });

  it("returns null for an unparseable URL", () => {
    expect(captureFirstTouchFromUrl("not-a-url", "")).toBeNull();
  });

  it("treats an empty UTM param the same as a missing one (undefined)", () => {
    const touch = captureFirstTouchFromUrl(
      "https://app.opsapp.co/?utm_source=&utm_medium=cpc",
      ""
    );
    expect(touch!.utm_source).toBeUndefined();
    expect(touch!.utm_medium).toBe("cpc");
  });
});

describe("writeCookieFirstTouch / readCookieFirstTouch", () => {
  beforeEach(() => {
    clearCookie();
  });
  afterEach(() => {
    clearCookie();
  });

  it("round-trips a value", () => {
    const touch: FirstTouch = {
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "spring",
      gclid: "abc123",
      landing_url: "https://app.opsapp.co/?utm_source=google",
      referrer: "https://google.com/",
      captured_at: "2026-04-21T00:00:00.000Z",
    };
    writeCookieFirstTouch(touch);
    const read = readCookieFirstTouch();
    expect(read).not.toBeNull();
    expect(read).toEqual(touch);
  });

  it("returns null when no cookie is set", () => {
    expect(readCookieFirstTouch()).toBeNull();
  });

  it("returns null when cookie value is malformed JSON", () => {
    document.cookie = `${COOKIE}=${encodeURIComponent("not-json")}; Path=/`;
    expect(readCookieFirstTouch()).toBeNull();
  });

  it("URL-encodes special characters in the value", () => {
    const touch: FirstTouch = {
      utm_campaign: "spring & summer",
      landing_url: "https://app.opsapp.co/?x=1&y=2",
      captured_at: "2026-04-21T00:00:00.000Z",
    };
    writeCookieFirstTouch(touch);
    // The raw cookie should not contain the unescaped ampersands inside the
    // payload — those would split the cookie string. The reader must still
    // round-trip the value correctly.
    const raw = document.cookie;
    expect(raw).toContain(COOKIE + "=");
    expect(readCookieFirstTouch()).toEqual(touch);
  });
});

describe("captureOnLanding", () => {
  beforeEach(() => {
    clearCookie();
  });
  afterEach(() => {
    clearCookie();
    vi.unstubAllGlobals();
  });

  it("writes a cookie when none exists", () => {
    // jsdom default location is http://localhost:3000 — set href via the
    // Location object so window.location.href reflects our test URL.
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("https://app.opsapp.co/?utm_source=google&utm_medium=cpc"),
    });
    captureOnLanding();
    const read = readCookieFirstTouch();
    expect(read).not.toBeNull();
    expect(read!.utm_source).toBe("google");
    expect(read!.utm_medium).toBe("cpc");
  });

  it("preserves the first-touch on subsequent calls (no overwrite)", () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("https://app.opsapp.co/?utm_source=google&utm_medium=cpc"),
    });
    captureOnLanding();
    const first = readCookieFirstTouch();
    expect(first!.utm_source).toBe("google");

    // Simulate a second landing with different attribution — first-touch
    // must win.
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("https://app.opsapp.co/?utm_source=facebook&utm_medium=social"),
    });
    captureOnLanding();
    const second = readCookieFirstTouch();
    expect(second!.utm_source).toBe("google");
    expect(second!.utm_medium).toBe("cpc");
  });
});
