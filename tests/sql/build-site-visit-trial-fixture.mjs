import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Schema-only fixture extension. The socket-only runner first installs the real
// P19 workflow fixture; this adds checked-in OAuth definitions, never production data.
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (name) => readFileSync(path.join(root, name), "utf8");
const emit = (sql) => process.stdout.write(`${sql}\n`);
emit("set check_function_bodies=off;");
for (const match of read("tests/sql/catalog-trial-setup.sql").matchAll(/^create table [\s\S]*?\n\);/gim)) {
  emit(match[0].replace(/create table /i, "create table if not exists "));
}
emit("alter table private.mcp_oauth_clients add primary key(client_id);");
for (const [table, key] of [["mcp_oauth_tokens", "token_hash"], ["mcp_oauth_authorization_codes", "code_hash"], ["mcp_oauth_consent_previews", "preview_hash"]]) {
  emit(`alter table private.${table} add primary key(${key});`);
}
emit("create table private.agent_catalog_effect_policy(revision text primary key,effect_sha256 text not null);");
const catalog = read("supabase/migrations/20260909015000_catalog_trial_oauth.sql");
emit(catalog.match(/create table private\.agent_catalog_trial_bindings \([\s\S]*?\n\);/)[0]);

// Function bodies remain byte-identical to their checked-in production sources.
// Last definition wins, just as in the migration ledger.
const definitions = new Map();
for (const name of [
  "tests/sql/catalog-trial-setup.sql",
  "tests/sql/catalog-trial-live-oauth.sql",
  "supabase/migrations/20260908221635_agent_catalog_authoring.sql",
  "supabase/migrations/20260909015000_catalog_trial_oauth.sql",
  "supabase/migrations/20260910233314_agent_deck_geometry_v23_exposure.sql",
]) {
  const text = read(name);
  for (const match of text.matchAll(/^create(?: or replace)? function\s+((?:private|public)\.\w+)\s*\(/gim)) {
    const functionName = match[1];
    if (!/mcp_oauth|mcp_v3_canary|financial_document_(hash|effect_revision)|user_is_active_company_member|agent_catalog_(effect_revision|trial_\w+)/.test(functionName)) continue;
    const tail = text.slice(match.index);
    const body = /\bas\s+(\$\w*\$)/i.exec(tail);
    if (!body) throw new Error(`Missing function body: ${functionName}`);
    const end = tail.indexOf(body[1], body.index + body[0].length);
    if (end < 0) throw new Error(`Unterminated function body: ${functionName}`);
    const closing = end + body[1].length;
    const terminator = /^\s*;/.exec(tail.slice(closing));
    if (!terminator) throw new Error(`Missing function terminator: ${functionName}`);
    const definition = tail.slice(0, closing + terminator[0].length);
    const signature = definition.slice(0, definition.indexOf(")") + 1).replace(/^create(?: or replace)? function\s+/i, "").replace(/\s+/g, " ");
    definitions.set(signature, definition.replace(/^create function/i, "create or replace function"));
  }
}
for (const definition of definitions.values()) emit(definition);
emit("revoke all on all functions in schema private from public,anon,authenticated,service_role;");
emit("revoke all on all functions in schema public from public,anon,authenticated;");
emit("grant execute on all functions in schema public to service_role;");
for (const table of ["mcp_oauth_clients", "mcp_oauth_grants", "mcp_oauth_authorization_codes", "mcp_oauth_consent_previews"]) {
  emit(`create trigger ${table}_immutable_trial_fixture before update on private.${table} for each row execute function private.enforce_mcp_oauth_consent_immutability();`);
}
for (const table of ["mcp_oauth_grants", "mcp_oauth_authorization_codes", "mcp_oauth_consent_previews", "mcp_oauth_tokens"]) {
  emit(`create trigger ${table}_canary_trial_fixture before insert on private.${table} for each row execute function private.enforce_mcp_v3_canary_write();`);
}
