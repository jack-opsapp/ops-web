import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SPEC_AUTH_GATES = [
  "src/app/admin/spec/layout.tsx",
  "src/lib/admin/spec-operator-guard.ts",
  "src/app/admin/spec/[id]/_actions/_require-operator.ts",
  "src/app/admin/spec/capacity/_actions/save-capacity.ts",
] as const;

describe("SPEC admin cookie precedence", () => {
  it.each(SPEC_AUTH_GATES)(
    "%s delegates cookie selection to the canonical auth helper",
    (path) => {
      const source = readFileSync(path, "utf8");

      expect(source).toContain("selectFirebaseIdTokenCookie(");
      expect(source).not.toMatch(
        /get\("__session"\)[\s\S]{0,120}get\("ops-auth-token"\)/
      );
    }
  );
});
