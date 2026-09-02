import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("social publishing documentation contract", () => {
  it("documents the scheduled-agent request, authentication, values, and idempotent response", () => {
    const guide = read("docs/social/scheduled-agent-contract.md");
    for (const required of [
      "POST /api/internal/social/posts",
      "SOCIAL_AUTOMATION_SECRET",
      "Idempotency-Key",
      "contract_version",
      "blog_signal",
      "editorial_cover",
      "single",
      "docs/social/voice/sam-parr-field-guide.md",
      "201",
      "200",
      "curl",
    ]) {
      expect(guide).toContain(required);
    }
  });

  it("documents credentials, storage, veto lifecycle, retries, quota, and production gates", () => {
    const runbook = read("docs/social/instagram-operations.md");
    for (const required of [
      "CRON_SECRET",
      "INSTAGRAM_APP_ID",
      "INSTAGRAM_APP_SECRET",
      "INSTAGRAM_TOKEN_ENC_KEY",
      "INSTAGRAM_GRAPH_ORIGIN",
      "INSTAGRAM_API_VERSION",
      "CONNECT INSTAGRAM",
      "/api/admin/social/instagram/callback",
      "60 days",
      "seven days before expiry",
      "SOCIAL_OPERATOR_USER_ID",
      "SOCIAL_OPERATOR_COMPANY_ID",
      "S3",
      "Supabase Storage",
      "10-minute",
      "5, 15, and 60 minutes",
      "content_publishing_limit",
      "PUBLISH_OUTCOME_UNKNOWN",
      "Do not retry",
      "not deployed",
    ]) {
      expect(runbook).toContain(required);
    }
  });

  it("lists every server-only variable in the environment template", () => {
    const environment = read(".env.example");
    for (const variable of [
      "SOCIAL_AUTOMATION_SECRET=",
      "SOCIAL_OPERATOR_USER_ID=",
      "SOCIAL_OPERATOR_COMPANY_ID=",
      "INSTAGRAM_APP_ID=",
      "INSTAGRAM_APP_SECRET=",
      "INSTAGRAM_TOKEN_ENC_KEY=",
      "INSTAGRAM_GRAPH_ORIGIN=",
      "INSTAGRAM_API_VERSION=",
      "CRON_SECRET=",
    ]) {
      expect(environment).toContain(variable);
    }
    expect(environment).not.toContain("INSTAGRAM_USER_ID=");
    expect(environment).not.toContain("INSTAGRAM_ACCESS_TOKEN=");
  });
});
