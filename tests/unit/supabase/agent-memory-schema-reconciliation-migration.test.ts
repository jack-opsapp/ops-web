import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260713204500_agent_memory_schema_reconciliation.sql"
);
const queueMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260713205000_email_outbound_learning_queue.sql"
);
const sql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";

describe("agent memory schema reconciliation migration", () => {
  it("runs before the outbound-learning queue in one transaction", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(basename(migrationPath) < basename(queueMigrationPath)).toBe(true);
    expect(sql.trim().startsWith("begin;")).toBe(true);
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });

  it("idempotently aligns both user identity columns to text without losing values", () => {
    for (const table of ["agent_memories", "agent_writing_profiles"]) {
      expect(sql).toMatch(
        new RegExp(
          `public\\.${table}[\\s\\S]*?attname = 'user_id'[\\s\\S]*?format_type\\(a\\.atttypid, a\\.atttypmod\\) <> 'text'`,
          "i"
        )
      );
      expect(sql).toMatch(
        new RegExp(
          `alter table public\\.${table}[\\s\\S]*?alter column user_id type text[\\s\\S]*?using user_id::text`,
          "i"
        )
      );
    }

    expect(sql).toMatch(
      /pg_constraint[\s\S]*?contype = 'f'[\s\S]*?attname = 'user_id'[\s\S]*?drop constraint/i
    );
  });

  it("converts half-precision memories to vector(1536) and rebuilds the cosine index", () => {
    expect(sql).toMatch(
      /join pg_catalog\.pg_type t[\s\S]*?not \(t\.typname = 'vector' and a\.atttypmod = 1536\)/i
    );
    expect(sql).toMatch(/drop index if exists public\.idx_am_embedding/i);
    expect(sql).toMatch(
      /alter table public\.agent_memories[\s\S]*?alter column embedding type vector\(1536\)[\s\S]*?using embedding::text::vector\(1536\)/i
    );
    expect(sql).toMatch(
      /create index if not exists idx_am_embedding[\s\S]*?using hnsw \(embedding vector_cosine_ops\)/i
    );
    expect(sql).not.toMatch(/idx_am_embedding[\s\S]*?halfvec_cosine_ops/i);
  });

  it("preserves writing-pattern values while converting JSONB arrays to text arrays", () => {
    expect(sql).toMatch(
      /create or replace function public\._ops_reconcile_20260713204500_jsonb_text_array\(\s*value jsonb\s*\)/i
    );
    expect(sql).toMatch(/jsonb_array_elements_text\(value\)/i);
    expect(sql).toMatch(/else array\[value #>> '\{\}'\]/i);

    for (const column of ["greeting_patterns", "closing_patterns"]) {
      expect(sql).toMatch(
        new RegExp(`attname = '${column}'[\\s\\S]*?if v_type = 'jsonb'`, "i")
      );
      expect(sql).toMatch(
        new RegExp(
          `alter column ${column} drop default[\\s\\S]*?alter column ${column} type text\\[\\][\\s\\S]*?using public\\._ops_reconcile_20260713204500_jsonb_text_array\\(${column}\\)[\\s\\S]*?alter column ${column} set default '\\{\\}'::text\\[\\]`,
          "i"
        )
      );
    }
    expect(sql).toMatch(
      /drop function public\._ops_reconcile_20260713204500_jsonb_text_array\(jsonb\)/i
    );
  });

  it("adds the production timestamp columns without rewriting aligned schemas", () => {
    expect(sql).toMatch(
      /alter table public\.agent_memories[\s\S]*?add column if not exists updated_at timestamptz not null default now\(\)/i
    );
    expect(sql).toMatch(
      /alter table public\.agent_knowledge_graph[\s\S]*?add column if not exists updated_at timestamptz not null default now\(\)/i
    );
  });

  it("provides the six-column knowledge-graph conflict arbiter without deleting duplicates", () => {
    expect(sql).toMatch(
      /array_agg\(a\.attname::text order by a\.attname::text\)[\s\S]*?array\[\s*'company_id',\s*'object_id',\s*'object_type',\s*'predicate',\s*'subject_id',\s*'subject_type'\s*\]/i
    );
    expect(sql).toMatch(/i\.indisunique[\s\S]*?i\.indimmediate/i);
    expect(sql).toMatch(
      /group by\s*company_id,\s*subject_type,\s*subject_id,\s*predicate,\s*object_type,\s*object_id[\s\S]*?having count\(\*\) > 1[\s\S]*?raise exception/i
    );
    expect(sql).toMatch(
      /add constraint agent_knowledge_graph_subject_object_unique[\s\S]*?unique \(\s*company_id,\s*subject_type,\s*subject_id,\s*predicate,\s*object_type,\s*object_id\s*\)/i
    );
    expect(sql).not.toMatch(/delete from public\.agent_knowledge_graph/i);
  });

  it("recreates match_memories against the canonical vector column", () => {
    expect(sql).toMatch(
      /create or replace function public\.match_memories\([\s\S]*?query_embedding vector\(1536\)/i
    );
    expect(sql).toMatch(/am\.embedding <=> query_embedding/i);
    expect(sql).toMatch(
      /alter function public\.match_memories\(vector, uuid, double precision, integer\)\s*set search_path = public, pg_temp/i
    );
  });
});
