import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/components/lockout/request-button.tsx"),
  "utf8"
);

describe("lockout notification request", () => {
  it("calls only the actor-derived narrow RPC", () => {
    expect(source).toMatch(/rpc\(\s*"request_lockout_admin_notification"/);
    expect(source).not.toContain("p_reason");
    expect(source).not.toMatch(/from\(["']notifications["']\)/);
    expect(source).not.toMatch(/user_id|company_id|title:|body:|action_url/);
  });
});
