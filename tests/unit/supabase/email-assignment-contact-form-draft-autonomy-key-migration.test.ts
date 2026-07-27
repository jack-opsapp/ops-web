import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase/migrations");
const functionSignature =
  "create or replace function private.email_assignment_contact_form_draft_authorized";

function readAuthorizationDefinitions(): Array<{
  name: string;
  migration: string;
  definition: string;
}> {
  return readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      migration: readFileSync(join(migrationsDirectory, name), "utf8"),
    }))
    .filter(({ migration }) =>
      migration.toLowerCase().includes(functionSignature)
    )
    .map(({ name, migration }) => {
      const functionStart = migration.toLowerCase().indexOf(functionSignature);
      const functionEnd =
        migration.indexOf("$function$;", functionStart) + "$function$;".length;

      return {
        name,
        migration,
        definition: migration.slice(functionStart, functionEnd),
      };
    });
}

describe("contact-form draft autonomy migration chain", () => {
  it("changes only the canonical case-sensitive CUSTOMER policy key", () => {
    const definitions = readAuthorizationDefinitions();
    const autonomyFixIndex = definitions.findIndex(
      ({ name }) =>
        name === "20260726201517_fix_contact_form_draft_autonomy_key.sql"
    );
    const previous = definitions[autonomyFixIndex - 1]?.definition ?? "";
    const final = definitions[autonomyFixIndex] ?? {
      name: "",
      migration: "",
      definition: "",
    };
    const latest = definitions.at(-1) ?? final;
    const compactFinalMigration = final.migration.replace(/\s+/g, " ");

    expect(autonomyFixIndex).toBeGreaterThan(0);
    expect(final.definition.toLowerCase()).toContain(functionSignature);
    expect(final.definition).toContain("->> 'primary:CUSTOMER'");
    expect(final.definition).not.toContain("->> 'primary:customer'");
    expect(
      final.definition.replace(
        "->> 'primary:CUSTOMER'",
        "->> 'primary:customer'"
      )
    ).toBe(previous);
    expect(compactFinalMigration).toContain(
      "revoke all on function private.email_assignment_contact_form_draft_authorized(uuid, boolean) from public, anon, authenticated, service_role;"
    );
    expect(latest.definition).toContain("->> 'primary:CUSTOMER'");
    expect(latest.definition).not.toContain("->> 'primary:customer'");
  });
});
