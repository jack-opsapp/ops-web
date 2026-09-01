import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SQL_DIRECTORY = join(process.cwd(), "tests/sql");

function fixture(name: string): string {
  return readFileSync(join(SQL_DIRECTORY, name), "utf8");
}

describe("durable MCP rate-limiter concurrency harness", () => {
  it("is an executable, disposable-PostgreSQL-17-only pgbench harness", () => {
    const path = join(SQL_DIRECTORY, "agent-mcp-rate-limiter-concurrency.sh");
    const script = fixture("agent-mcp-rate-limiter-concurrency.sh");

    expect(statSync(path).mode & 0o111).not.toBe(0);
    expect(script).toContain("pgbench");
    expect(script).toContain("server_version_num");
    expect(script).toContain("ops_mcp_rate_limit_test_");
    expect(script).toContain("agent-mcp-rate-limiter-trigger-collision.sql");
  });

  it("launches 31 synchronized same-bucket contenders and proves 30 allows plus one coupled denial", () => {
    const script = fixture("agent-mcp-rate-limiter-concurrency.sh");
    const workload = fixture("agent-mcp-rate-limiter-same-bucket.pgbench.sql");
    const verification = fixture(
      "agent-mcp-rate-limiter-concurrency-verify.sql"
    );

    expect(script).toContain('"${PGBENCH[@]}" -c "$clients" -j "$jobs"');
    expect(script).toMatch(/run_pgbench_race\s+31\s+31\b/);
    expect(workload).toContain("pg_advisory_lock_shared(:barrier_key)");
    expect(workload).toContain("consume_agent_mcp_rate_limit_as_system");
    expect(verification).toContain("same_bucket_allowed_count <> 30");
    expect(verification).toContain("same_bucket_denial_count <> 1");
    expect(verification).toContain("same_bucket_audit_count <> 1");
  });

  it("races two grants at a company ceiling and proves one complete three-bucket increment", () => {
    const script = fixture("agent-mcp-rate-limiter-concurrency.sh");
    const workload = fixture(
      "agent-mcp-rate-limiter-shared-company.pgbench.sql"
    );
    const setup = fixture("agent-mcp-rate-limiter-concurrency-setup.sql");
    const verification = fixture(
      "agent-mcp-rate-limiter-concurrency-verify.sql"
    );

    expect(script).toMatch(/run_pgbench_race\s+2\s+2\b/);
    expect(workload).toContain("statement_timeout");
    expect(setup).toContain("insert into private.mcp_oauth_grants");
    expect(setup).toContain("v_company_units constant integer := 119");
    expect(workload).toContain("pg_advisory_lock_shared(:barrier_key)");
    expect(verification).toContain("shared_company_units is distinct from 120");
    expect(verification).toContain("shared_actor_units is distinct from 1");
    expect(verification).toContain("shared_grant_units is distinct from 1");
    expect(verification).toContain("shared_company_audit_count <> 1");
  });
});
