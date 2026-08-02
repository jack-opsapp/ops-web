import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const POSTGRES_IDENTIFIER_BYTES = 63;
const SRC_DIR = path.join(process.cwd(), "src");
const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20260801003000_fix_contact_form_draft_rpc_identifiers.sql"
  ),
  "utf8"
);
const runtime = readFileSync(
  path.join(
    SRC_DIR,
    "lib/api/services/email-assignment-contact-form-draft-runtime.ts"
  ),
  "utf8"
);

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

describe("PostgREST RPC identifier length", () => {
  it("keeps every static application RPC name within PostgreSQL's 63-byte limit", () => {
    const overlong: string[] = [];
    for (const file of sourceFiles(SRC_DIR)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\.rpc\(\s*["']([^"']+)["']/g)) {
        const rpcName = match[1];
        if (Buffer.byteLength(rpcName, "utf8") > POSTGRES_IDENTIFIER_BYTES) {
          overlong.push(`${path.relative(process.cwd(), file)}: ${rpcName}`);
        }
      }
    }

    expect(overlong).toEqual([]);
  });

  it("routes provider placement through stable short service-only RPCs", () => {
    for (const rpcName of [
      "begin_assignment_contact_draft_provider_create_as_system",
      "mark_assignment_contact_draft_reconciliation_as_system",
    ]) {
      expect(Buffer.byteLength(rpcName, "utf8")).toBeLessThanOrEqual(
        POSTGRES_IDENTIFIER_BYTES
      );
      expect(runtime).toContain(`.rpc(\n        "${rpcName}"`);
      expect(migration).toContain(
        `create or replace function public.${rpcName}(`
      );
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${rpcName}\\([\\s\\S]*?grant execute on function public\\.${rpcName}\\([\\s\\S]*?to service_role;`
        )
      );
    }

    expect(migration).toContain(
      "coalesce(auth.jwt() ->> 'role', '') <> 'service_role'"
    );
    expect(migration).toContain("set search_path = ''");
    expect(runtime).not.toContain(
      '"begin_email_assignment_contact_form_draft_provider_create_as_system"'
    );
    expect(runtime).not.toContain(
      '"mark_email_assignment_contact_form_draft_reconciliation_required_as_system"'
    );
  });

  it("delegates only to the two catalog names verified live after truncation", () => {
    expect(migration).toContain(
      "public.begin_email_assignment_contact_form_draft_provider_create_as_sy("
    );
    expect(migration).toContain(
      "public.mark_email_assignment_contact_form_draft_reconciliation_require("
    );
    expect(migration).toContain(
      "contact_form_draft_truncated_rpc_prerequisites_missing"
    );
  });
});
