import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";

const VERSION_RE = /^\s*\/\/\s*@template-version:\s*(\d+\.\d+\.\d+)\s*$/m;

function parseVersion(src: string): string | null {
  const m = VERSION_RE.exec(src);
  return m ? m[1] : null;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

describe("template-version-sync helpers", () => {
  it("parses 1.0.0", () => {
    expect(parseVersion("// @template-version: 1.0.0\nfoo")).toBe("1.0.0");
  });
  it("parses 12.34.567", () => {
    expect(parseVersion("// @template-version: 12.34.567\n")).toBe("12.34.567");
  });
  it("returns null when missing", () => {
    expect(parseVersion("hello world")).toBeNull();
  });
  it("rejects non-semver", () => {
    expect(parseVersion("// @template-version: 1.0\n")).toBeNull();
    expect(parseVersion("// @template-version: latest\n")).toBeNull();
  });
  it("ignores trailing whitespace", () => {
    expect(parseVersion("// @template-version: 2.1.0   \n")).toBe("2.1.0");
  });
  it("sha256 is deterministic", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
  });
  it("sha256 differs on byte change", () => {
    expect(sha256("hello")).not.toBe(sha256("hello!"));
  });
});
