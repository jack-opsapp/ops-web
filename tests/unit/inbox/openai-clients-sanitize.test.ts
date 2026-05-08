/**
 * Coverage for `sanitizeApiKey` — the boundary defense that strips
 * literal `\n` suffixes and trailing whitespace from API keys read out
 * of `process.env`. The literal `\n` shape comes from POSIX shells
 * sourcing a `.env.local` written with `OPENAI_API_KEY="sk-...\n"` —
 * the two-character backslash+n survives the source step and gets
 * passed straight to the OpenAI SDK, which 401s on the malformed key.
 */

import { describe, expect, it } from "vitest";

import { sanitizeApiKey } from "@/lib/api/services/openai-clients";

describe("sanitizeApiKey", () => {
  it("returns undefined for missing values", () => {
    expect(sanitizeApiKey(undefined)).toBeUndefined();
    expect(sanitizeApiKey("")).toBeUndefined();
  });

  it("returns clean keys unchanged", () => {
    const key = "sk-proj-abc123";
    expect(sanitizeApiKey(key)).toBe(key);
  });

  it("strips a trailing literal backslash-n", () => {
    expect(sanitizeApiKey("sk-proj-abc123\\n")).toBe("sk-proj-abc123");
  });

  it("strips trailing whitespace", () => {
    expect(sanitizeApiKey("sk-proj-abc123   ")).toBe("sk-proj-abc123");
    expect(sanitizeApiKey("sk-proj-abc123\t")).toBe("sk-proj-abc123");
  });

  it("strips both literal backslash-n AND trailing whitespace", () => {
    expect(sanitizeApiKey("sk-proj-abc123\\n   ")).toBe("sk-proj-abc123");
    expect(sanitizeApiKey("sk-proj-abc123  \\n")).toBe("sk-proj-abc123");
  });

  it("strips leading whitespace", () => {
    expect(sanitizeApiKey("   sk-proj-abc123")).toBe("sk-proj-abc123");
  });

  it("returns undefined when sanitization empties the key", () => {
    expect(sanitizeApiKey("\\n")).toBeUndefined();
    expect(sanitizeApiKey("   ")).toBeUndefined();
  });

  it("preserves a real newline inside the key (only literal \\n is stripped)", () => {
    // A genuine newline character mid-string would never appear in a
    // valid OpenAI key, but if it did we should not silently mangle it.
    // The regex only matches the two-char literal `\n` at end-of-string.
    const withRealNewline = "sk-proj-abc\n123";
    expect(sanitizeApiKey(withRealNewline)).toBe(withRealNewline);
  });

  it("idempotent: sanitizing twice produces the same result", () => {
    const dirty = "sk-proj-abc123\\n  ";
    const once = sanitizeApiKey(dirty);
    const twice = sanitizeApiKey(once);
    expect(once).toBe("sk-proj-abc123");
    expect(twice).toBe(once);
  });
});
