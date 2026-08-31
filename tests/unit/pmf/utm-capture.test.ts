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
  encodeFirstTouchPayload,
  FIRST_TOUCH_MAX_ENCODED_BYTES,
  parseFirstTouchValue,
  readServerFirstTouch,
  type FirstTouch,
} from "@/lib/pmf/utm-capture";

const COOKIE = "__ops_first_touch";
const ANONYMOUS_ID = "11111111-1111-4111-8111-111111111111";
const BASE_TOUCH = {
  version: 1 as const,
  anonymous_id: ANONYMOUS_ID,
  captured_at: "2026-04-21T00:00:00.000Z",
  landing_path: "/",
};

function touch(over: Partial<FirstTouch> = {}): FirstTouch {
  return { ...BASE_TOUCH, ...over };
}

function clearCookie(): void {
  // Expire the cookie. jsdom honours the Path attribute.
  document.cookie = `${COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  document.cookie = `ops_attribution=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
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

  it("stores only an external referrer domain", () => {
    const touch = captureFirstTouchFromUrl(
      "https://app.opsapp.co/?utm_source=newsletter",
      "https://www.google.com/search?q=private"
    );
    expect(touch!.referrer_domain).toBe("google.com");
  });

  it("excludes internal OPS referrals", () => {
    const touch = captureFirstTouchFromUrl(
      "https://app.opsapp.co/?utm_source=newsletter",
      "https://blog.opsapp.co/post"
    );
    expect(touch!.referrer_domain).toBeUndefined();
  });

  it("handles URLs with no UTM params and strips the query from its landing path", () => {
    const touch = captureFirstTouchFromUrl("https://app.opsapp.co/", "");
    expect(touch).not.toBeNull();
    expect(touch!.utm_source).toBeUndefined();
    expect(touch!.utm_medium).toBeUndefined();
    expect(touch!.utm_campaign).toBeUndefined();
    expect(touch!.utm_content).toBeUndefined();
    expect(touch!.utm_term).toBeUndefined();
    expect(touch!.gclid).toBeUndefined();
    expect(touch!.fbclid).toBeUndefined();
    expect(touch!.landing_path).toBe("/");
    expect(touch!.version).toBe(1);
    expect(touch!.anonymous_id).toMatch(/^[0-9a-f-]{36}$/i);
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
  // Save the real window.location once so we can restore it after any test
  // that overrides it (writeCookieFirstTouch reads window.location.protocol).
  const originalLocation = window.location;

  beforeEach(() => {
    clearCookie();
  });
  afterEach(() => {
    clearCookie();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it("round-trips a value", () => {
    const value = touch({
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "spring",
      gclid: "abc123",
      landing_path: "/",
      referrer_domain: "google.com",
    });
    writeCookieFirstTouch(value);
    const read = readCookieFirstTouch();
    expect(read).not.toBeNull();
    expect(read).toEqual(value);
  });

  it("returns null when no cookie is set", () => {
    expect(readCookieFirstTouch()).toBeNull();
  });

  it("returns null when cookie value is malformed JSON", () => {
    document.cookie = `${COOKIE}=${encodeURIComponent("not-json")}; Path=/`;
    expect(readCookieFirstTouch()).toBeNull();
  });

  it("returns null when the parsed JSON is an array", () => {
    const value = encodeURIComponent(JSON.stringify(["utm_source", "google"]));
    document.cookie = `${COOKIE}=${value}; Path=/`;
    expect(readCookieFirstTouch()).toBeNull();
  });

  it("returns null when the parsed JSON is a primitive (string)", () => {
    const value = encodeURIComponent(JSON.stringify("just-a-string"));
    document.cookie = `${COOKIE}=${value}; Path=/`;
    expect(readCookieFirstTouch()).toBeNull();
  });

  it("returns null when the parsed JSON is a primitive (number)", () => {
    const value = encodeURIComponent(JSON.stringify(42));
    document.cookie = `${COOKIE}=${value}; Path=/`;
    expect(readCookieFirstTouch()).toBeNull();
  });

  it("returns null when the parsed JSON is null", () => {
    const value = encodeURIComponent(JSON.stringify(null));
    document.cookie = `${COOKIE}=${value}; Path=/`;
    expect(readCookieFirstTouch()).toBeNull();
  });

  it("drops junk fields and preserves the valid string fields", () => {
    const value = encodeURIComponent(
      JSON.stringify({
        ...BASE_TOUCH,
        utm_source: "google",
        utm_medium: "cpc",
        // Junk fields below should be dropped entirely.
        __proto__pollution: "evil",
        nested: { foo: "bar" },
        array_field: [1, 2, 3],
        captured_at: "2026-04-21T00:00:00.000Z",
      })
    );
    document.cookie = `${COOKIE}=${value}; Path=/`;
    const read = readCookieFirstTouch();
    expect(read).not.toBeNull();
    expect(read!.utm_source).toBe("google");
    expect(read!.utm_medium).toBe("cpc");
    expect(read!.captured_at).toBe("2026-04-21T00:00:00.000Z");
    // Junk fields are not exposed on the FirstTouch shape.
    expect((read as unknown as Record<string, unknown>).nested).toBeUndefined();
    expect(
      (read as unknown as Record<string, unknown>).array_field
    ).toBeUndefined();
  });

  it("coerces non-string FirstTouch fields to undefined", () => {
    const value = encodeURIComponent(
      JSON.stringify({
        ...BASE_TOUCH,
        utm_source: 123, // number, not string
        utm_medium: { malicious: true }, // object, not string
        utm_campaign: ["a", "b"], // array, not string
        gclid: "valid-gclid",
      })
    );
    document.cookie = `${COOKIE}=${value}; Path=/`;
    const read = readCookieFirstTouch();
    expect(read).not.toBeNull();
    expect(read!.utm_source).toBeUndefined();
    expect(read!.utm_medium).toBeUndefined();
    expect(read!.utm_campaign).toBeUndefined();
    expect(read!.gclid).toBe("valid-gclid");
    expect(read!.captured_at).toBe(BASE_TOUCH.captured_at);
  });

  it("URL-encodes special characters in the value", () => {
    const value = touch({
      utm_campaign: "spring & summer",
    });
    writeCookieFirstTouch(value);
    // The raw cookie should not contain the unescaped ampersands inside the
    // payload — those would split the cookie string. The reader must still
    // round-trip the value correctly.
    const raw = document.cookie;
    expect(raw).toContain(COOKIE + "=");
    expect(readCookieFirstTouch()).toEqual(value);
  });

  it("bounds pathological campaign payloads below the cookie ceiling", () => {
    const oversized = touch({
      landing_path: `/${"路".repeat(1800)}`,
      utm_source: "源".repeat(500),
      utm_campaign: "春".repeat(500),
      gclid: "x".repeat(900),
    });
    const encoded = encodeFirstTouchPayload(oversized);

    expect(encoded.length).toBeLessThanOrEqual(FIRST_TOUCH_MAX_ENCODED_BYTES);
    expect(parseFirstTouchValue(encoded)).toMatchObject({
      anonymous_id: ANONYMOUS_ID,
      version: 1,
    });
  });

  it("does NOT add the Secure flag on HTTP", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: new URL("http://localhost:3000/"),
    });
    const value = touch({
      utm_source: "test",
    });
    writeCookieFirstTouch(value);
    // jsdom's document.cookie strips attributes like Secure, but the cookie
    // is still set when Secure is omitted on http origins. (Setting Secure
    // on http would cause jsdom to silently drop the cookie.)
    expect(readCookieFirstTouch()).not.toBeNull();
  });
});

describe("captureOnLanding", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    clearCookie();
  });
  afterEach(() => {
    clearCookie();
    vi.unstubAllGlobals();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it("writes a cookie when none exists", () => {
    // Use http:// for the stubbed location — jsdom's document origin is
    // http://localhost, and writeCookieFirstTouch only adds the Secure
    // flag on https. Setting Secure under an http document causes jsdom
    // to silently drop the cookie. The URL parsing logic doesn't care
    // about the scheme, so this still exercises captureOnLanding fully.
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: new URL("http://localhost/?utm_source=google&utm_medium=cpc"),
    });
    captureOnLanding();
    const read = readCookieFirstTouch();
    expect(read).not.toBeNull();
    expect(read!.utm_source).toBe("google");
    expect(read!.utm_medium).toBe("cpc");
  });

  it("preserves the first-touch on subsequent calls (no overwrite)", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: new URL("http://localhost/?utm_source=google&utm_medium=cpc"),
    });
    captureOnLanding();
    const first = readCookieFirstTouch();
    expect(first!.utm_source).toBe("google");

    // Simulate a second landing with different attribution — first-touch
    // must win.
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: new URL("http://localhost/?utm_source=facebook&utm_medium=social"),
    });
    captureOnLanding();
    const second = readCookieFirstTouch();
    expect(second!.utm_source).toBe("google");
    expect(second!.utm_medium).toBe("cpc");
  });
});

// ─── Server-side reader (Attribution capture P2) ─────────────────────────────

describe("parseFirstTouchValue", () => {
  it("parses a valid encoded payload", () => {
    const raw = encodeURIComponent(
      JSON.stringify({
        ...BASE_TOUCH,
        utm_source: "google",
        gclid: "abc123",
        captured_at: "2026-08-06T00:00:00.000Z",
      })
    );
    const parsed = parseFirstTouchValue(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.utm_source).toBe("google");
    expect(parsed!.gclid).toBe("abc123");
  });

  it("returns null for malformed JSON", () => {
    expect(parseFirstTouchValue("%7Bnot-json")).toBeNull();
  });

  it("returns null for a JSON array", () => {
    expect(
      parseFirstTouchValue(encodeURIComponent(JSON.stringify([1, 2])))
    ).toBeNull();
  });

  it("coerces non-string fields to undefined", () => {
    const raw = encodeURIComponent(
      JSON.stringify({ ...BASE_TOUCH, utm_source: 123, utm_medium: "cpc" })
    );
    const parsed = parseFirstTouchValue(raw);
    expect(parsed!.utm_source).toBeUndefined();
    expect(parsed!.utm_medium).toBe("cpc");
  });

  it("truncates oversized values rather than storing unbounded text", () => {
    const raw = encodeURIComponent(
      JSON.stringify({ ...BASE_TOUCH, utm_campaign: "x".repeat(1000) })
    );
    expect(parseFirstTouchValue(raw)!.utm_campaign!.length).toBe(256);
  });
});

describe("readServerFirstTouch", () => {
  function header(...touches: Array<Record<string, unknown>>): string {
    return touches
      .map(
        (t) =>
          `${COOKIE}=${encodeURIComponent(JSON.stringify({ ...BASE_TOUCH, ...t }))}`
      )
      .join("; ");
  }

  it("reads the cookie from a raw Cookie header", () => {
    const h = header({
      utm_source: "meta",
      captured_at: "2026-08-06T00:00:00.000Z",
    });
    expect(readServerFirstTouch(h)!.utm_source).toBe("meta");
  });

  it("returns null when the cookie is absent", () => {
    expect(readServerFirstTouch("other=1; another=2")).toBeNull();
  });

  it("returns null for a null/empty header", () => {
    expect(readServerFirstTouch(null)).toBeNull();
    expect(readServerFirstTouch("")).toBeNull();
  });

  it("ignores cookies whose name merely ends with the cookie name", () => {
    const h = `not__ops_first_touch=${encodeURIComponent(JSON.stringify({ utm_source: "bad" }))}`;
    expect(readServerFirstTouch(h)).toBeNull();
  });

  it("picks the EARLIEST captured_at when a host-only and a domain cookie coexist", () => {
    // A host-only app.opsapp.co cookie and a .opsapp.co cookie can both be
    // sent. First-touch semantics must not depend on browser ordering.
    const h = header(
      { utm_source: "later", captured_at: "2026-08-06T12:00:00.000Z" },
      { utm_source: "earlier", captured_at: "2026-08-01T09:00:00.000Z" }
    );
    expect(readServerFirstTouch(h)!.utm_source).toBe("earlier");
  });

  it("skips malformed duplicates and still returns the valid one", () => {
    const good = encodeURIComponent(
      JSON.stringify({
        ...BASE_TOUCH,
        utm_source: "google",
        captured_at: "2026-08-02T00:00:00.000Z",
      })
    );
    const h = `${COOKIE}=%7Bbroken; ${COOKIE}=${good}`;
    expect(readServerFirstTouch(h)!.utm_source).toBe("google");
  });

  it("migrates the prior canonical cookie shape with a stable anonymous ID", () => {
    const legacyCanonical = encodeURIComponent(
      JSON.stringify({
        captured_at: "2026-08-02T00:00:00.000Z",
        landing_url: "/plans?utm_source=google",
        utm_source: "google",
      })
    );
    const first = readServerFirstTouch(`${COOKIE}=${legacyCanonical}`);
    const second = readServerFirstTouch(`${COOKIE}=${legacyCanonical}`);

    expect(first).not.toBeNull();
    expect(first!.landing_path).toBe("/plans");
    expect(first!.anonymous_id).toBe(second!.anonymous_id);
    expect(first!.anonymous_id).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe("readServerFirstTouch — ops_attribution (marketing-site cookie)", () => {
  const SITE_COOKIE = "ops_attribution";

  function siteCookie(payload: Record<string, unknown>): string {
    return `${SITE_COOKIE}=${encodeURIComponent(
      JSON.stringify({ landing_url: "/", ...payload })
    )}`;
  }

  it("reads the marketing-site cookie, mapping first_touch_at to captured_at", () => {
    // ops-site writes `ops_attribution` (with first_touch_at); ops-web's own
    // client writes `__ops_first_touch` (with captured_at). Most real traffic
    // arrives with ONLY the marketing-site cookie, so missing this name would
    // leave nearly every signup unattributed.
    const touch = readServerFirstTouch(
      siteCookie({
        utm_source: "google",
        gclid: "Cj0KCQ",
        landing_url: "/plans?utm_source=google",
        first_touch_at: "2026-08-06T00:00:00.000Z",
      })
    );
    expect(touch).not.toBeNull();
    expect(touch!.utm_source).toBe("google");
    expect(touch!.gclid).toBe("Cj0KCQ");
    expect(touch!.landing_path).toBe("/plans");
    expect(touch!.captured_at).toBe("2026-08-06T00:00:00.000Z");
  });

  it("prefers the EARLIEST touch when both cookies are present", () => {
    const header = [
      `${COOKIE}=${encodeURIComponent(
        JSON.stringify({
          ...BASE_TOUCH,
          utm_source: "app-direct",
          captured_at: "2026-08-06T12:00:00.000Z",
        })
      )}`,
      siteCookie({
        utm_source: "site-first",
        first_touch_at: "2026-08-01T09:00:00.000Z",
      }),
    ].join("; ");
    expect(readServerFirstTouch(header)!.utm_source).toBe("site-first");
  });

  it("ignores a malformed marketing-site cookie", () => {
    expect(readServerFirstTouch(`${SITE_COOKIE}=%7Bbroken`)).toBeNull();
  });
});

describe("readServerFirstTouch — double-encoded marketing-site cookie", () => {
  // REGRESSION: ops-site writes with encodeURIComponent AND NextResponse.cookies.set
  // encodes again, so the wire value is DOUBLE percent-encoded. ops-site round-trips
  // fine (its request parser decodes once, its own code decodes again), but this
  // reader parses the RAW Cookie header — a single decode leaves '%7B%22...' and
  // JSON.parse throws, silently yielding zero attribution for every web signup.
  //
  // The literal below is copied verbatim from the real Set-Cookie header emitted
  // by writeAttributionCookie under NODE_ENV=production.
  const REAL_WIRE_VALUE =
    "%257B%2522landing_url%2522%253A%2522%252Fplans%253Futm_source%253Dgoogle%2522%252C%2522first_touch_at%2522%253A%25222026-08-06T17%253A20%253A09.413Z%2522%252C%2522utm_source%2522%253A%2522google%2522%252C%2522utm_medium%2522%253A%2522cpc%2522%252C%2522gclid%2522%253A%2522Cj0KCQabc%2522%257D";

  it("parses the real double-encoded value ops-site puts on the wire", () => {
    const touch = readServerFirstTouch(`ops_attribution=${REAL_WIRE_VALUE}`);
    expect(touch).not.toBeNull();
    expect(touch!.utm_source).toBe("google");
    expect(touch!.utm_medium).toBe("cpc");
    expect(touch!.gclid).toBe("Cj0KCQabc");
    expect(touch!.captured_at).toBe("2026-08-06T17:20:09.413Z");
  });

  it("still parses a singly-encoded value", () => {
    const single = encodeURIComponent(
      JSON.stringify({
        ...BASE_TOUCH,
        utm_source: "meta",
        captured_at: "2026-08-06T00:00:00.000Z",
      })
    );
    expect(readServerFirstTouch(`${COOKIE}=${single}`)!.utm_source).toBe(
      "meta"
    );
  });

  it("still returns null for genuinely malformed values", () => {
    expect(readServerFirstTouch(`${COOKIE}=not-json-at-all`)).toBeNull();
  });
});
