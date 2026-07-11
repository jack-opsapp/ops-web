import { describe, expect, it } from "vitest";
import {
  buildReturnRedirect,
  sanitizeReturnTo,
} from "@/lib/utils/oauth-return";

const APP_URL = "https://app.ops.test";

describe("sanitizeReturnTo", () => {
  it("accepts app-internal absolute paths", () => {
    expect(sanitizeReturnTo("/pipeline")).toBe("/pipeline");
    expect(sanitizeReturnTo("/pipeline?tab=focused")).toBe(
      "/pipeline?tab=focused"
    );
    expect(sanitizeReturnTo("/settings?tab=integrations")).toBe(
      "/settings?tab=integrations"
    );
  });

  it("rejects absolute external URLs", () => {
    expect(sanitizeReturnTo("https://evil.com")).toBeNull();
    expect(sanitizeReturnTo("http://evil.com/pipeline")).toBeNull();
    expect(sanitizeReturnTo("javascript:alert(1)")).toBeNull();
  });

  it("rejects protocol-relative URLs", () => {
    expect(sanitizeReturnTo("//evil.com")).toBeNull();
    expect(sanitizeReturnTo("//evil.com/pipeline")).toBeNull();
  });

  it("rejects backslash and header-splitting variants", () => {
    expect(sanitizeReturnTo("/\\evil.com")).toBeNull();
    expect(sanitizeReturnTo("/pipeline\\..")).toBeNull();
    expect(sanitizeReturnTo("/pipeline\r\nSet-Cookie: x=1")).toBeNull();
    expect(sanitizeReturnTo("/pipeline\nLocation: https://evil.com")).toBeNull();
  });

  it("rejects non-string and empty values", () => {
    expect(sanitizeReturnTo(undefined)).toBeNull();
    expect(sanitizeReturnTo(null)).toBeNull();
    expect(sanitizeReturnTo(42)).toBeNull();
    expect(sanitizeReturnTo("")).toBeNull();
    expect(sanitizeReturnTo("pipeline")).toBeNull();
  });
});

describe("buildReturnRedirect", () => {
  it("appends result params to the app-origin redirect", () => {
    expect(
      buildReturnRedirect(APP_URL, "/pipeline", { connected: "gmail" })
    ).toBe(`${APP_URL}/pipeline?connected=gmail`);
    expect(
      buildReturnRedirect(APP_URL, "/pipeline", { connect_error: "1" })
    ).toBe(`${APP_URL}/pipeline?connect_error=1`);
  });

  it("preserves existing query params on the return path", () => {
    expect(
      buildReturnRedirect(APP_URL, "/pipeline?mode=table", {
        connected: "microsoft365",
      })
    ).toBe(`${APP_URL}/pipeline?mode=table&connected=microsoft365`);
  });

  it("returns null for anything the sanitizer rejects", () => {
    expect(
      buildReturnRedirect(APP_URL, "https://evil.com", { connected: "gmail" })
    ).toBeNull();
    expect(
      buildReturnRedirect(APP_URL, "//evil.com", { connected: "gmail" })
    ).toBeNull();
    expect(buildReturnRedirect(APP_URL, "", { connected: "gmail" })).toBeNull();
  });
});
