import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase/migrations");
const functionSignature =
  "create or replace function private.email_assignment_contact_form_draft_prior_placement";

function readFinalPriorPlacementDefinition(): string {
  const definitions = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) =>
      readFileSync(join(migrationsDirectory, name), "utf8").toLowerCase()
    )
    .filter((migration) => migration.includes(functionSignature));

  const finalMigration = definitions.at(-1) ?? "";
  const functionStart = finalMigration.indexOf(functionSignature);
  const functionEnd = finalMigration.indexOf("$function$;", functionStart);

  return finalMigration.slice(functionStart, functionEnd);
}

describe("contact-form draft prior-placement migration chain", () => {
  it("keeps PL/pgSQL record variables distinct from SQL table aliases", () => {
    const definition = readFinalPriorPlacementDefinition();
    const declareStart = definition.indexOf("declare");
    const bodyStart = definition.indexOf("begin", declareStart);
    const declarationBlock = definition.slice(declareStart, bodyStart);
    const declaredRecords = Array.from(
      declarationBlock.matchAll(
        /^\s*([a-z_][a-z0-9_]*)\s+public\.[a-z0-9_.]+%rowtype;/gm
      ),
      (match) => match[1]
    );
    const tableAliases = Array.from(
      definition.matchAll(
        /\b(?:from|join)\s+public\.[a-z0-9_.]+\s+([a-z_][a-z0-9_]*)\b/g
      ),
      (match) => match[1]
    );

    expect(definition).toContain(functionSignature);
    expect(
      declaredRecords.filter((record) => tableAliases.includes(record))
    ).toEqual([]);
  });
});
