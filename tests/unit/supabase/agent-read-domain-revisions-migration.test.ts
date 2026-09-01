import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_SUFFIX = "_agent_read_domain_revisions.sql";
const CLOSED_DOMAINS = [
  "customer",
  "tasks",
  "artifacts",
  "site_visits",
  "deck_designs",
  "sales_documents",
  "payments",
  "expenses",
  "work_queue",
  "catalog",
  "purchasing",
  "company",
  "team",
  "availability",
  "integrations",
] as const;

function migrationSql(): string {
  const directory = join(process.cwd(), "supabase/migrations");
  const matches = readdirSync(directory)
    .filter((file) => file.endsWith(MIGRATION_SUFFIX))
    .sort();

  expect(
    matches,
    `expected exactly one migration ending in ${MIGRATION_SUFFIX}`
  ).toHaveLength(1);

  return matches.length === 1
    ? readFileSync(join(directory, matches[0]), "utf8")
    : "";
}

function compact(source: string): string {
  return source
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function functionDefinition(source: string, signature: string): string {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+${escaped}[\\s\\S]*?\\$function\\$\\s*;`,
      "i"
    )
  );

  expect(match, `${signature} is missing`).toBeTruthy();
  return compact(match?.[0] ?? "");
}

describe("agent read-domain revisions migration", () => {
  it("creates one private, tenant-and-domain keyed, JS-safe monotonic fence", () => {
    const sql = compact(migrationSql());

    expect(sql).toContain(
      "create table if not exists private.agent_read_domain_revisions"
    );
    expect(sql).toMatch(/primary key\s*\(\s*company_id\s*,\s*domain\s*\)/i);
    expect(sql).toMatch(
      /source_revision bigint not null default 0[\s\S]*?check\s*\(\s*source_revision between 0 and 9007199254740991\s*\)/i
    );
    expect(sql).not.toMatch(
      /agent_read_domain_revisions[\s\S]{0,500}references\s+public\.companies/i
    );

    expect(sql).toContain(
      "create table if not exists private.agent_read_domains"
    );
    expect(sql).toMatch(
      /constraint agent_read_domain_revisions_domain_closed foreign key \(domain\) references private\.agent_read_domains\s*\(domain\)/i
    );
  });

  it("uses one closed vocabulary for the constraint, both seed paths, and advances", () => {
    const sql = compact(migrationSql());
    const advance = functionDefinition(
      migrationSql(),
      "private.advance_agent_read_domain_revisions"
    );
    const seed = functionDefinition(
      migrationSql(),
      "private.seed_agent_read_domain_revisions"
    );
    const vocabularyInsert = sql.match(
      /insert into private\.agent_read_domains\s*\(\s*domain\s*\) values([\s\S]*?)on conflict \(domain\) do nothing/i
    );

    expect(vocabularyInsert, "domain vocabulary seed is missing").toBeTruthy();
    const insertedDomains = [
      ...(vocabularyInsert?.[1] ?? "").matchAll(/'([^']+)'/g),
    ].map((match) => match[1]);
    expect(insertedDomains).toEqual(CLOSED_DOMAINS);
    expect(sql).toMatch(
      /from public\.companies company cross join private\.agent_read_domains domain/i
    );
    expect(seed).toContain("from private.agent_read_domains domain");
    expect(advance).toMatch(
      /from private\.agent_read_domains domain where domain\.domain = p_domain/i
    );
  });

  it("keeps the table and all helpers inaccessible to application roles", () => {
    const sql = compact(migrationSql());
    const normalizedSignatures = sql.replace(/\s*,\s*/g, ",");

    expect(sql).toMatch(
      /revoke all on table private\.agent_read_domain_revisions from public, anon, authenticated, service_role/i
    );
    expect(sql).toMatch(
      /revoke all on table private\.agent_read_domains from public, anon, authenticated, service_role/i
    );
    for (const signature of [
      "private.agent_read_domain_uuid_from_text(text)",
      "private.advance_agent_read_domain_revisions(uuid[],text)",
      "private.advance_agent_read_domain_revision(uuid,text)",
      "private.seed_agent_read_domain_revisions()",
      "private.bump_agent_read_domain_revision()",
    ]) {
      expect(normalizedSignatures.toLowerCase()).toContain(
        `revoke all on function ${signature} from public,anon,authenticated,service_role`
      );
    }
    expect(sql).not.toMatch(
      /grant\s+(?:all|select|insert|update|delete|execute)/i
    );
  });

  it("uses one atomic ordered upsert and fails instead of wrapping the safe-integer ceiling", () => {
    const batch = functionDefinition(
      migrationSql(),
      "private.advance_agent_read_domain_revisions"
    );

    expect(batch).toContain("security definer");
    expect(batch).toMatch(
      /set search_path (?:to|=) 'pg_catalog', 'private', 'pg_temp'/i
    );
    expect(batch).toMatch(
      /select distinct company_id[\s\S]*?order by company_id/i
    );
    expect(batch).toMatch(
      /insert into private\.agent_read_domain_revisions as revision[\s\S]*?on conflict \(company_id, domain\) do update/i
    );
    expect(batch).toContain(
      "where revision.source_revision < 9007199254740991"
    );
    expect(batch).toMatch(
      /agent_read_domain_revision_exhausted[\s\S]*?errcode = '22003'/i
    );
  });

  it("seeds all existing and newly inserted companies without revision churn", () => {
    const sql = compact(migrationSql());
    const seed = functionDefinition(
      migrationSql(),
      "private.seed_agent_read_domain_revisions"
    );

    expect(sql).toMatch(
      /insert into private\.agent_read_domain_revisions[\s\S]*?from public\.companies[\s\S]*?on conflict \(company_id, domain\) do nothing/i
    );
    expect(seed).toContain("new.id");
    expect(seed).toContain("on conflict (company_id, domain) do nothing");
    expect(sql).toMatch(
      /create trigger companies_seed_agent_read_domain_revisions after insert on public\.companies for each row execute function private\.seed_agent_read_domain_revisions\(\)/i
    );
  });

  it("defines a closed two-argument trigger contract with safe OLD and NEW tenant resolution", () => {
    const bump = functionDefinition(
      migrationSql(),
      "private.bump_agent_read_domain_revision"
    );

    expect(bump).toContain("tg_nargs is distinct from 2");
    expect(bump).toContain("agent_read_domain_revision_trigger_misconfigured");
    expect(bump).toContain("v_old_row := to_jsonb(old)");
    expect(bump).toContain("v_old_row ->> tg_argv[1]");
    expect(bump).toContain("v_new_row := to_jsonb(new)");
    expect(bump).toContain("v_new_row ->> tg_argv[1]");
    expect(bump).toContain("private.agent_read_domain_uuid_from_text(");
    expect(bump).toMatch(
      /perform private\.advance_agent_read_domain_revisions\([\s\S]*?v_old_company_id[\s\S]*?v_new_company_id[\s\S]*?tg_argv\[0\]/i
    );
    expect(bump).toContain("return null");
  });

  it("ends with a catalog postflight for replay collisions, object properties, and ACLs", () => {
    const sql = compact(migrationSql());
    const postflight = sql.match(/do \$postflight\$([\s\S]*?)\$postflight\$;/i);

    expect(postflight, "catalog postflight is missing").toBeTruthy();
    const body = postflight?.[1] ?? "";
    for (const marker of [
      "agent_read_domain_catalog_domain_table_invalid",
      "agent_read_domain_catalog_revision_table_invalid",
      "agent_read_domain_catalog_constraint_invalid",
      "agent_read_domain_catalog_index_invalid",
      "agent_read_domain_catalog_function_invalid",
      "agent_read_domain_catalog_trigger_invalid",
      "agent_read_domain_catalog_private_trigger_invalid",
      "agent_read_domain_catalog_acl_invalid",
      "agent_read_domain_catalog_vocabulary_invalid",
    ]) {
      expect(body).toContain(marker);
    }
    expect(body).toContain("pg_catalog.pg_attribute");
    expect(body).toContain("pg_catalog.pg_constraint");
    expect(body).toContain("pg_catalog.pg_index");
    expect(body).toContain("pg_catalog.pg_proc");
    expect(body).toContain("pg_catalog.pg_trigger");
    expect(body).toContain("has_table_privilege");
    expect(body).toContain("has_function_privilege");
    expect(body).toContain("procedure.proowner = v_expected_owner");
    expect(body).toContain("relation.relowner = v_expected_owner");
  });
});
