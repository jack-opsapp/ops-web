// @vitest-environment node
/**
 * Individual permission saves, end to end, on a disposable PostgreSQL 17
 * cluster with a real PostgREST in front of it, built by
 * scripts/test-permission-overrides-postgres.sh.
 *
 * The database carries production's whole save path byte-identical (proved by
 * tests/sql/permission-overrides-fidelity.sql), with the save at the
 * definition production ran from 2026-07-15 until ledger 20260918022722, plus
 * the synthetic people and leads in tests/sql/permission-overrides-seed.sql.
 *
 * Every save below goes through the real PUT /api/users/[id]/permission-
 * overrides handler, the real service-role supabase-js client, PostgREST and a
 * real COMMIT, the way the Settings editor and the iOS app reach it. Only
 * Firebase token verification is replaced. Payloads are built with the
 * editor's own helpers, so the editor, the route and the database are proved
 * to agree on the same request.
 */

import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PUT } from "@/app/api/users/[id]/permission-overrides/route";
import {
  buildEditablePermissionDesiredState,
  normalizePipelinePermissionEdits,
  type PermissionEditState,
} from "@/lib/permissions/pipeline-dependencies";
import {
  computeOverrideMutation,
  diffAgainstRole,
  resolveEffectivePermissions,
  type OverrideInput,
  type RolePermissionInput,
} from "@/lib/permissions/resolve";
import {
  PERMISSION_CATEGORIES,
  PERMISSION_EDITOR_REGISTRY,
  type PermissionScope,
} from "@/lib/types/permissions";
import { server as mswServer } from "../mocks/server";

vi.mock("@/lib/firebase/admin-verify", () => ({
  // The only replaced dependency: a harness token names the auth subject the
  // seed gave each person, exactly what a verified Firebase token yields.
  verifyAuthToken: async (token: string) => {
    const match = /^harness:(harness-auth-[ab]\d{3})$/.exec(token);
    if (!match) throw new Error("invalid token");
    return { uid: match[1], email: undefined };
  },
}));

const execFileAsync = promisify(execFile);
const ROOT = resolve(__dirname, "../..");
const RUN = process.env.OPS_RUN_PERMISSION_OVERRIDES_POSTGRES === "1";
const PSQL = process.env.OPS_PSQL_BIN ?? "/opt/homebrew/opt/postgresql@17/bin/psql";
const PG_HOST = process.env.OPS_PGHOST ?? "/tmp";
const PG_PORT = process.env.OPS_PGPORT ?? "55621";
const DATABASE = process.env.OPS_PERMISSION_OVERRIDES_DB ?? "overrides_runtime";
const REST_URL = process.env.OPS_POSTGREST_URL ?? "";
const JWT_SECRET = process.env.OPS_POSTGREST_JWT_SECRET ?? "";
const TIMEOUT_MS = 120_000;
// Never inherit PGOPTIONS, PGSERVICE, passwords or application credentials.
const ENV: NodeJS.ProcessEnv = {
  NODE_ENV: process.env.NODE_ENV,
  PATH: process.env.PATH,
  LANG: "C",
  LC_ALL: "C",
};

const REPAIR =
  "supabase/migrations/20260918022722_permission_overrides_clear_alias.sql";
const RPC =
  "public.apply_user_permission_overrides_as_system(uuid,uuid,jsonb,jsonb,text[],jsonb)";
/** Production's save from 2026-07-15 until the repair. */
const RELEASED_MD5 = "74ca941e37b9813a30db902b52c91e13";
/** Production's live save since ledger 20260918022722. */
const PRODUCTION_MD5 = "8e1cb41e52232d3217024a68baed4e27";

const id = (suffix: string) => `6e000000-0000-4000-8000-00000000${suffix}`;
const ALPHA = id("a101"); // Owner preset: may change permissions and hand off leads
const BRAVO = id("a102"); // account holder (admin)
const CHARLIE = id("a103"); // Office preset: no team.assign_roles
const DELTA = id("a104"); // Crew, carrying a real crew member's override shape
const ECHO = id("a105"); // Crew
const FOXTROT = id("a106"); // Operator responsible for five leads
const GOLF = id("a107"); // Operator responsible for one lead
const HOTEL = id("a108"); // Crew: cannot see leads
const INDIA = id("a109"); // deactivated
const LIMA = id("a110"); // carries the internal SPEC override in its valid shape
const MIKE = id("a111"); // carries an override stamped with another company
const NOVEMBER = id("a112"); // carries spec.admin outside its valid shape
const JULIET = id("b101"); // Owner at the bystander company
const COMPANY = id("a000");
const MAILBOX = id("e001");
/** The internal SPEC company the one valid spec.admin override is stamped with. */
const SPEC_COMPANY = "00000000-0000-0000-0000-00000000000a";
const LEAD = {
  one: id("c001"),
  two: id("c002"),
  won: id("c003"),
  archived: id("c004"),
  deleted: id("c005"),
  golfs: id("c006"),
  bystander: id("c101"),
};

const HIDDEN_PERMISSION_IDS = new Set(
  PERMISSION_CATEGORIES.flatMap((category) => category.modules)
    .flatMap((module) => module.actions)
    .filter((action) => action.hiddenFromEditor)
    .map((action) => action.id)
);
const EDITOR_ACTIONS = PERMISSION_CATEGORIES.flatMap((category) =>
  category.modules.flatMap((module) => module.actions)
);

// ── Database access (the harness cluster only) ──────────────────────────────

function assertSafeTarget(): void {
  const localSocket =
    isAbsolute(PG_HOST) &&
    (PG_HOST === "/tmp" ||
      PG_HOST.startsWith("/tmp/") ||
      PG_HOST === "/private/tmp" ||
      PG_HOST.startsWith("/private/tmp/"));
  const port = Number(PG_PORT);
  const rest = /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(REST_URL);
  if (
    !localSocket ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    port === 5_432 ||
    !rest ||
    JWT_SECRET.length < 32
  ) {
    throw new Error(
      "Permission override runtime requires the harness's local socket, a non-default port and a loopback PostgREST"
    );
  }
}

async function sql(query: string): Promise<string> {
  const { stdout } = await execFileAsync(
    PSQL,
    ["-h", PG_HOST, "-p", PG_PORT, "-U", "postgres", "-d", DATABASE, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", query],
    { env: ENV, timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
  );
  return stdout.trim();
}

async function sqlJson<T>(query: string): Promise<T> {
  return JSON.parse(await sql(query)) as T;
}

async function saveFunctionMd5(): Promise<string> {
  return sql(`select md5(pg_get_functiondef('${RPC}'::regprocedure))`);
}

/** Everything a save may write, so "nothing written" is a whole-database claim. */
async function mutableState(): Promise<unknown> {
  return sqlJson(`select json_build_object(
    'overrides', (select coalesce(json_agg(json_build_object('user_id', user_id, 'company_id', company_id, 'permission', permission, 'scope', scope, 'granted', granted, 'updated_at', updated_at) order by user_id, permission), '[]') from public.user_permission_overrides),
    'deliveries', (select coalesce(json_agg(json_build_object('recipient', recipient_user_id, 'kind', change_kind, 'transaction', transaction_id) order by id), '[]') from public.user_permission_change_deliveries),
    'outbox', (select coalesce(json_agg(json_build_object('actor', actor_user_id, 'reason', reason, 'requested_at', requested_at) order by actor_user_id, connection_id), '[]') from public.email_signature_notification_lifecycle_outbox),
    'leads', (select json_agg(json_build_object('id', id, 'assigned_to', assigned_to, 'version', assignment_version, 'updated_at', updated_at) order by id) from public.opportunities),
    'events', (select count(*) from public.opportunity_assignment_events),
    'drafts', (select coalesce(json_agg(json_build_object('lead', opportunity_id, 'actor', actor_user_id, 'version', assignment_version, 'status', status, 'updated_at', updated_at) order by id), '[]') from public.email_assignment_contact_form_draft_queue),
    'assignment_deliveries', (select count(*) from public.opportunity_assignment_deliveries),
    'notifications', (select count(*) from public.notifications)
  )`);
}

async function overridesOf(userId: string): Promise<OverrideInput[]> {
  return sqlJson(
    `select private.canonical_user_override_snapshot('${userId}'::uuid)`
  );
}

/** What the Settings editor loads for a member: role grants and overrides. */
async function memberAccess(userId: string): Promise<{
  rolePermissions: RolePermissionInput[];
  overrides: OverrideInput[];
}> {
  return {
    rolePermissions: await sqlJson(`select coalesce(json_agg(json_build_object('permission', rp.permission, 'scope', rp.scope) order by rp.permission), '[]')
      from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id
     where ur.user_id = '${userId}'`),
    overrides: await overridesOf(userId),
  };
}

// ── The editor's request, built with its own helpers ────────────────────────

interface SaveBody {
  expectedOverrides: OverrideInput[];
  set: OverrideInput[];
  clear: string[];
  assignmentResolutions: Resolution[];
}

interface Resolution {
  opportunity_id: string;
  expected_assigned_to: string;
  expected_assignment_version: number;
  new_assigned_to: string | null;
}

/**
 * member-access-view.tsx: seed every editor row from the member's effective
 * access, apply the manager's edits (null switches a permission off), run the
 * pipeline normalization the editor runs after every edit, then diff against
 * the role and trim to the minimal write. Sorted exactly as handleSave sorts.
 */
function editorSave(
  access: { rolePermissions: RolePermissionInput[]; overrides: OverrideInput[] },
  edits: Record<string, PermissionScope | null>
): SaveBody {
  const effective = resolveEffectivePermissions(access.rolePermissions, access.overrides);
  const rows = new Map<string, PermissionEditState>();
  for (const action of EDITOR_ACTIONS) {
    const scope = effective.get(action.id);
    rows.set(action.id, {
      permission: action.id,
      scope: scope ?? action.scopes[0],
      enabled: effective.has(action.id),
    });
  }
  let edited = normalizePipelinePermissionEdits(rows);
  for (const [permission, scope] of Object.entries(edits)) {
    const row = edited.get(permission);
    if (!row) throw new Error(`the editor has no row for ${permission}`);
    edited.set(permission, scope === null ? { ...row, enabled: false } : { ...row, scope, enabled: true });
    edited = normalizePipelinePermissionEdits(edited);
  }
  const desired = buildEditablePermissionDesiredState(edited, HIDDEN_PERMISSION_IDS);
  const mutation = computeOverrideMutation(
    access.overrides,
    diffAgainstRole(access.rolePermissions, desired)
  );
  return {
    expectedOverrides: [...access.overrides].sort((a, b) => a.permission.localeCompare(b.permission)),
    set: [...mutation.set].sort((a, b) => a.permission.localeCompare(b.permission)),
    clear: [...mutation.clear].sort((a, b) => a.localeCompare(b)),
    assignmentResolutions: [],
  };
}

async function save(
  actor: string,
  target: string,
  body: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await PUT(
    new NextRequest(`http://localhost/api/users/${target}/permission-overrides`, {
      method: "PUT",
      headers: {
        authorization: `Bearer harness:harness-auth-${actor.slice(-4)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: target }) }
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

// ── PostgREST behind the path Supabase's gateway serves it on ───────────────

function jwt(role: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ role, iss: "ops-permission-overrides-harness", iat: 1_700_000_000, exp: 4_102_444_800 });
  const signature = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** Every body this gateway carries is JSON text. */
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Supabase serves PostgREST under /rest/v1; this gateway does the same. */
function startGateway(): Promise<Server> {
  const gateway = createServer(async (request, response) => {
    try {
      const path = (request.url ?? "/").replace(/^\/rest\/v1/, "");
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined || ["host", "connection", "content-length", "accept-encoding"].includes(name)) continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);
      const upstream = await fetch(`${REST_URL}${path}`, { method: request.method, headers, body });
      const out: Record<string, string> = {};
      upstream.headers.forEach((value, name) => {
        if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(name)) out[name] = value;
      });
      response.writeHead(upstream.status, out);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (failure) {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: String(failure) }));
    }
  });
  return new Promise((ready) => gateway.listen(0, "127.0.0.1", () => ready(gateway)));
}

/** The RPC called directly as a service-role API client would, past the route. */
async function directRpc(args: Record<string, unknown>, role = "service_role"): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${REST_URL}/rpc/apply_user_permission_overrides_as_system`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(role === "anon" ? {} : { authorization: `Bearer ${jwt(role)}` }),
    },
    body: JSON.stringify(args),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

let gateway: Server | null = null;

describe.skipIf(!RUN)("individual permission saves through the real route (disposable PostgreSQL 17 + PostgREST)", () => {
  beforeAll(async () => {
    assertSafeTarget();
    // This file talks to real local services; the suite-wide request mocks
    // would otherwise sit between supabase-js and PostgREST.
    mswServer.close();
    gateway = await startGateway();
    process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwt("service_role");
  }, TIMEOUT_MS);

  afterAll(async () => {
    await new Promise((done) => (gateway ? gateway.close(done) : done(undefined)));
  });

  it("starts from production's save exactly as it ran from 2026-07-15", async () => {
    expect(await saveFunctionMd5()).toBe(RELEASED_MD5);
  });

  it("reproduces the outage: every save answered 500 on a 42702 and wrote nothing", async () => {
    const before = await mutableState();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // The save a manager made on 2026-09-18: pipeline view, edit and convert
      // on the crew member's own leads.
      const grant = editorSave(await memberAccess(DELTA), {
        "pipeline.view": "assigned",
        "pipeline.edit": "assigned",
        "pipeline.convert": "assigned",
      });
      expect(grant.set).toEqual([
        { permission: "pipeline.convert", scope: "assigned", granted: true },
        { permission: "pipeline.edit", scope: "assigned", granted: true },
        { permission: "pipeline.view", scope: "assigned", granted: true },
      ]);
      expect(grant.clear).toEqual([]);
      expect(await save(ALPHA, DELTA, grant)).toEqual({
        status: 500,
        body: { code: "permission_update_failed" },
      });
      // The exact line production logged at 02:21:47Z.
      expect(logged).toHaveBeenCalledWith(
        "[api/users/[id]/permission-overrides] Guarded RPC failed",
        { code: "42702", message: 'column reference "permission" is ambiguous' }
      );

      // Not just this request: a save with nothing to set or clear fails too.
      expect(await save(ALPHA, ECHO, editorSave(await memberAccess(ECHO), {}))).toEqual({
        status: 500,
        body: { code: "permission_update_failed" },
      });
      expect(logged).toHaveBeenCalledTimes(2);
    } finally {
      logged.mockRestore();
    }
    expect(await mutableState()).toEqual(before);
  });

  it("installs the repair under the running API, byte-identical to production's live save", async () => {
    await execFileAsync(
      PSQL,
      ["-h", PG_HOST, "-p", PG_PORT, "-U", "postgres", "-d", DATABASE, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", join(ROOT, REPAIR)],
      { env: ENV, timeout: TIMEOUT_MS }
    );
    expect(await saveFunctionMd5()).toBe(PRODUCTION_MD5);
  });

  it("grants a crew member pipeline access on their own leads (the save that failed)", async () => {
    const outboxBefore = await sql(`select requested_at from public.email_signature_notification_lifecycle_outbox where actor_user_id = '${DELTA}' and connection_id = '${MAILBOX}'`);
    const deliveriesBefore = Number(await sql(`select count(*) from public.user_permission_change_deliveries where recipient_user_id = '${DELTA}'`));
    const grant = editorSave(await memberAccess(DELTA), {
      "pipeline.view": "assigned",
      "pipeline.edit": "assigned",
      "pipeline.convert": "assigned",
    });

    const result = await save(ALPHA, DELTA, grant);

    const expected = [
      // Kept exactly as stored, even though the editor no longer offers the scope.
      { permission: "calendar.edit", scope: "assigned", granted: true },
      { permission: "deck_builder.view", scope: "all", granted: true },
      { permission: "pipeline.convert", scope: "assigned", granted: true },
      { permission: "pipeline.edit", scope: "assigned", granted: true },
      { permission: "pipeline.view", scope: "assigned", granted: true },
      { permission: "projects.edit", scope: "assigned", granted: true },
    ];
    expect(result).toEqual({
      status: 200,
      body: { ok: true, userId: DELTA, overrides: expected, resolvedAssignments: 0 },
    });
    expect(await overridesOf(DELTA)).toEqual(expected);
    // The permission-change fan-out committed with the save: one delivery for
    // the member, and their company mailbox re-queued for the signature check.
    expect(Number(await sql(`select count(*) from public.user_permission_change_deliveries where recipient_user_id = '${DELTA}' and change_kind = 'user_override'`))).toBe(deliveriesBefore + 1);
    const outboxAfter = await sql(`select requested_at || '|' || reason || '|' || (processed_at is null) from public.email_signature_notification_lifecycle_outbox where actor_user_id = '${DELTA}' and connection_id = '${MAILBOX}' and company_id = '${COMPANY}'`);
    expect(outboxAfter.split("|").slice(1)).toEqual(["permission_changed", "true"]);
    expect(outboxAfter.split("|")[0]).not.toBe(outboxBefore);
  });

  it("clears overrides (the statement that was broken, with a real clear list)", async () => {
    const clear = editorSave(await memberAccess(DELTA), {
      "pipeline.view": null,
      "pipeline.edit": null,
      "pipeline.convert": null,
    });
    expect(clear.set).toEqual([]);
    expect(clear.clear).toEqual(["pipeline.convert", "pipeline.edit", "pipeline.view"]);

    const result = await save(ALPHA, DELTA, clear);

    const expected = [
      { permission: "calendar.edit", scope: "assigned", granted: true },
      { permission: "deck_builder.view", scope: "all", granted: true },
      { permission: "projects.edit", scope: "assigned", granted: true },
    ];
    expect(result).toEqual({
      status: 200,
      body: { ok: true, userId: DELTA, overrides: expected, resolvedAssignments: 0 },
    });
    expect(await overridesOf(DELTA)).toEqual(expected);
  });

  it("sets and clears in one save", async () => {
    // Back to the role's own deck_builder.view (a clear) plus a new projects.edit (a set).
    const body = editorSave(await memberAccess(ECHO), {
      "deck_builder.view": "assigned",
      "projects.edit": "assigned",
    });
    expect(body.set).toEqual([{ permission: "projects.edit", scope: "assigned", granted: true }]);
    expect(body.clear).toEqual(["deck_builder.view"]);

    const expected = [{ permission: "projects.edit", scope: "assigned", granted: true }];
    expect(await save(ALPHA, ECHO, body)).toEqual({
      status: 200,
      body: { ok: true, userId: ECHO, overrides: expected, resolvedAssignments: 0 },
    });
    expect(await overridesOf(ECHO)).toEqual(expected);
  });

  it("switches off something the role grants", async () => {
    const body = editorSave(await memberAccess(ECHO), { "notifications.view": null });
    expect(body.set).toEqual([{ permission: "notifications.view", scope: null, granted: false }]);

    const expected = [
      { permission: "notifications.view", scope: null, granted: false },
      { permission: "projects.edit", scope: "assigned", granted: true },
    ];
    expect(await save(ALPHA, ECHO, body)).toEqual({
      status: 200,
      body: { ok: true, userId: ECHO, overrides: expected, resolvedAssignments: 0 },
    });
    expect(await overridesOf(ECHO)).toEqual(expected);
  });

  it("answers a save with no changes without writing anything", async () => {
    const before = await mutableState();
    const body = editorSave(await memberAccess(ECHO), {});
    expect(body.set).toEqual([]);
    expect(body.clear).toEqual([]);
    expect(await save(ALPHA, ECHO, body)).toEqual({
      status: 200,
      body: { ok: true, userId: ECHO, overrides: body.expectedOverrides, resolvedAssignments: 0 },
    });
    expect(await mutableState()).toEqual(before);
  });

  it("refuses a save made against a stale screen and returns what is stored now", async () => {
    const before = await mutableState();
    const stale = editorSave(
      { rolePermissions: (await memberAccess(ECHO)).rolePermissions, overrides: [] },
      { "calendar.edit": "own" }
    );
    expect(await save(ALPHA, ECHO, stale)).toEqual({
      status: 409,
      body: { code: "permission_snapshot_mismatch", currentOverrides: await overridesOf(ECHO) },
    });
    expect(await mutableState()).toEqual(before);
  });

  it("refuses managers without team.assign_roles, other companies, admins and missing people", async () => {
    const before = await mutableState();
    const body = editorSave(await memberAccess(ECHO), { "calendar.edit": "own" });

    expect(await save(CHARLIE, ECHO, body)).toEqual({ status: 403, body: { code: "access_denied" } });
    expect(await save(ALPHA, JULIET, editorSave(await memberAccess(JULIET), { "calendar.edit": "own" }))).toEqual({
      status: 403,
      body: { code: "access_denied" },
    });
    expect(await save(ALPHA, BRAVO, editorSave(await memberAccess(BRAVO), {}))).toEqual({
      status: 409,
      body: { code: "target_is_admin" },
    });
    expect(await save(ALPHA, INDIA, editorSave(await memberAccess(INDIA), {}))).toEqual({
      status: 404,
      body: { code: "target_user_not_found" },
    });
    expect(await save(ALPHA, id("f404"), { ...body, expectedOverrides: [] })).toEqual({
      status: 404,
      body: { code: "target_user_not_found" },
    });
    expect(await mutableState()).toEqual(before);
  });

  it("saves for the person carrying the internal SPEC override and leaves it untouched", async () => {
    const specRow = `select json_build_object('company_id', company_id, 'scope', scope, 'granted', granted, 'updated_at', updated_at) from public.user_permission_overrides where user_id = '${LIMA}' and permission = 'spec.admin'`;
    const before = await sqlJson(specRow);
    const body = editorSave(await memberAccess(LIMA), { "projects.edit": "assigned" });
    // The editor never shows spec.admin, so it is neither set nor cleared.
    expect(body.set).toEqual([{ permission: "projects.edit", scope: "assigned", granted: true }]);
    expect(body.clear).toEqual([]);

    const expected = [
      { permission: "projects.edit", scope: "assigned", granted: true },
      { permission: "spec.admin", scope: "all", granted: true },
    ];
    expect(await save(ALPHA, LIMA, body)).toEqual({
      status: 200,
      body: { ok: true, userId: LIMA, overrides: expected, resolvedAssignments: 0 },
    });
    expect(await overridesOf(LIMA)).toEqual(expected);
    expect(await sqlJson(specRow)).toEqual(before);
    expect(before).toMatchObject({ company_id: SPEC_COMPANY, scope: "all", granted: true });
  });

  it("refuses to build on corrupt overrides and writes nothing", async () => {
    const before = await mutableState();
    expect(await save(ALPHA, MIKE, editorSave(await memberAccess(MIKE), { "calendar.edit": "own" }))).toEqual({
      status: 400,
      body: { code: "stale_company_override" },
    });
    expect(await save(ALPHA, NOVEMBER, editorSave(await memberAccess(NOVEMBER), { "calendar.edit": "own" }))).toEqual({
      status: 400,
      body: { code: "protected_permission_override_invalid" },
    });
    expect(await mutableState()).toEqual(before);
  });

  it("refuses pipeline access the editor would never send (edit wider than view)", async () => {
    const before = await mutableState();
    // The editor caps edit at view; iOS and direct callers are held to the
    // same dependency rules by the database.
    const body = {
      expectedOverrides: await overridesOf(GOLF),
      set: [{ permission: "pipeline.edit", scope: "all", granted: true }],
      clear: [],
      assignmentResolutions: [],
    };
    expect(await save(ALPHA, GOLF, body)).toEqual({
      status: 400,
      body: { code: "invalid_permission_dependencies" },
    });
    expect(await mutableState()).toEqual(before);
  });

  it("validates the clear list in the database for callers that skip the route", async () => {
    const before = await mutableState();
    const expected = await overridesOf(ECHO);
    const call = (set: unknown, clear: unknown) =>
      directRpc({
        p_actor_user_id: ALPHA,
        p_target_user_id: ECHO,
        p_expected_overrides: expected,
        p_set: set,
        p_clear: clear,
        p_assignment_resolutions: [],
      });

    // The route refuses an unregistered clear before the database sees it.
    expect(await save(ALPHA, ECHO, { expectedOverrides: expected, set: [], clear: ["not.a.permission"], assignmentResolutions: [] })).toEqual({
      status: 400,
      body: { code: "invalid_request" },
    });
    // The database's own check (the statement that raised 42702) answers each
    // bad list the same way, and writes nothing.
    for (const [set, clear] of [
      [[], ["not.a.permission"]],
      [[], ["projects.edit", "projects.edit"]],
      [[], [null]],
      [[], null],
      [[{ permission: "projects.edit", scope: "all", granted: true }], ["projects.edit"]],
    ] as const) {
      const result = await call(set, clear);
      expect(result.body).toMatchObject({ code: "22023", message: "invalid_override_set_clear" });
    }
    // A registered permission with nothing stored is a valid, empty clear.
    expect((await call([], ["pipeline.view"])).body).toMatchObject({ ok: true, overrides: expected });
    expect(await mutableState()).toEqual(before);
  });

  it("asks who takes the leads before removing lead access, and writes nothing", async () => {
    const before = await mutableState();
    const body = editorSave(await memberAccess(FOXTROT), { "pipeline.view": null });
    // Switching off view takes every pipeline action that depends on it.
    expect(body.set).toEqual([
      { permission: "pipeline.assign", scope: null, granted: false },
      { permission: "pipeline.convert", scope: null, granted: false },
      { permission: "pipeline.create", scope: null, granted: false },
      { permission: "pipeline.edit", scope: null, granted: false },
      { permission: "pipeline.view", scope: null, granted: false },
    ]);

    expect(await save(ALPHA, FOXTROT, body)).toEqual({
      status: 409,
      body: {
        code: "assignment_resolution_required",
        strandedCount: 2,
        // Only open leads: the won, archived and deleted ones stay history.
        stranded: [
          { opportunity_id: LEAD.one, title: "Harness lead one", assigned_to: FOXTROT, assignment_version: 1 },
          { opportunity_id: LEAD.two, title: "Harness lead two", assigned_to: FOXTROT, assignment_version: 1 },
        ],
        // Everyone who can see leads, never the person losing access.
        eligibleAssignees: [
          { id: ALPHA, first_name: "Alpha", last_name: "Owner", profile_image_url: null, user_color: null, role: "owner" },
          { id: BRAVO, first_name: "Bravo", last_name: "Holder", profile_image_url: null, user_color: null, role: "admin" },
          { id: CHARLIE, first_name: "Charlie", last_name: "Office", profile_image_url: null, user_color: null, role: "office" },
          { id: GOLF, first_name: "Golf", last_name: "Operator", profile_image_url: null, user_color: null, role: "operator" },
        ],
      },
    });
    expect(await mutableState()).toEqual(before);
  });

  it("refuses a handoff that is stale, incomplete, too broad or to someone who cannot see leads", async () => {
    const before = await mutableState();
    const body = editorSave(await memberAccess(FOXTROT), { "pipeline.view": null });
    const handoff = (resolutions: Resolution[]) => save(ALPHA, FOXTROT, { ...body, assignmentResolutions: resolutions });
    const lead = (opportunity: string, to: string | null, version = 1): Resolution => ({
      opportunity_id: opportunity,
      expected_assigned_to: FOXTROT,
      expected_assignment_version: version,
      new_assigned_to: to,
    });

    expect(await handoff([lead(LEAD.one, null, 0), lead(LEAD.two, GOLF)])).toEqual({
      status: 409,
      body: { code: "assignment_resolution_conflict", opportunity_id: LEAD.one, assigned_to: FOXTROT, assignment_version: 1 },
    });
    expect(await handoff([lead(LEAD.one, null)])).toEqual({ status: 400, body: { code: "missing_resolution" } });
    expect(await handoff([lead(LEAD.one, null), lead(LEAD.two, GOLF), lead(LEAD.won, GOLF)])).toEqual({
      status: 400,
      body: { code: "extra_resolution" },
    });
    // The first lead's unassignment is applied before the second is refused;
    // the whole save rolls back with it.
    expect(await handoff([lead(LEAD.one, null), lead(LEAD.two, HOTEL)])).toEqual({
      status: 400,
      body: { code: "assignment_target_ineligible" },
    });
    expect(await mutableState()).toEqual(before);
  });

  it("removes lead access and hands the open leads off in one save", async () => {
    const eventsBefore = Number(await sql("select count(*) from public.opportunity_assignment_events"));
    const body = editorSave(await memberAccess(FOXTROT), { "pipeline.view": null });
    const result = await save(ALPHA, FOXTROT, {
      ...body,
      assignmentResolutions: [
        { opportunity_id: LEAD.one, expected_assigned_to: FOXTROT, expected_assignment_version: 1, new_assigned_to: null },
        { opportunity_id: LEAD.two, expected_assigned_to: FOXTROT, expected_assignment_version: 1, new_assigned_to: GOLF },
      ],
    });

    const denied = body.set;
    expect(result).toEqual({
      status: 200,
      body: { ok: true, userId: FOXTROT, overrides: denied, resolvedAssignments: 2 },
    });
    expect(await overridesOf(FOXTROT)).toEqual(denied);
    expect(
      await sqlJson(`select json_object_agg(id, json_build_array(assigned_to, assignment_version) order by id) from public.opportunities`)
    ).toEqual({
      [LEAD.one]: [null, 2],
      [LEAD.two]: [GOLF, 2],
      [LEAD.won]: [FOXTROT, 1],
      [LEAD.archived]: [FOXTROT, 1],
      [LEAD.deleted]: [FOXTROT, 1],
      [LEAD.golfs]: [GOLF, 1],
      [LEAD.bystander]: [JULIET, 1],
    });
    expect(
      await sqlJson(`select json_agg(json_build_object('lead', opportunity_id, 'from', previous_assignee_id, 'to', new_assignee_id, 'by', actor_user_id, 'source', source, 'version', assignment_version, 'metadata', metadata) order by opportunity_id)
        from public.opportunity_assignment_events where source = 'permission_change'`)
    ).toEqual([
      { lead: LEAD.one, from: FOXTROT, to: null, by: ALPHA, source: "permission_change", version: 2, metadata: { mutation_kind: "user_overrides", subject_id: FOXTROT, disposition: "unassign" } },
      { lead: LEAD.two, from: FOXTROT, to: GOLF, by: ALPHA, source: "permission_change", version: 2, metadata: { mutation_kind: "user_overrides", subject_id: FOXTROT, disposition: "transfer" } },
    ]);
    expect(Number(await sql("select count(*) from public.opportunity_assignment_events"))).toBe(eventsBefore + 2);
    // Lead two is a website contact-form email: the departing operator's
    // pending first reply is superseded and a fresh one queues for Golf.
    expect(
      await sqlJson(`select json_agg(json_build_object('actor', actor_user_id, 'version', assignment_version, 'status', status, 'last_error', last_error, 'customer', customer_email) order by assignment_version)
        from public.email_assignment_contact_form_draft_queue where opportunity_id = '${LEAD.two}'`)
    ).toEqual([
      { actor: FOXTROT, version: 1, status: "stale", last_error: "assignment superseded", customer: "visitor@example.test" },
      { actor: GOLF, version: 2, status: "pending", last_error: null, customer: "visitor@example.test" },
    ]);
  });

  it("keeps the save service-only at the API boundary", async () => {
    const before = await mutableState();
    const args = {
      p_actor_user_id: ALPHA,
      p_target_user_id: ECHO,
      p_expected_overrides: await overridesOf(ECHO),
      p_set: [],
      p_clear: [],
      p_assignment_resolutions: [],
    };
    for (const role of ["authenticated", "anon"]) {
      const result = await directRpc(args, role);
      expect(result.status).toBe(role === "anon" ? 401 : 403);
      expect(result.body).toMatchObject({
        code: "42501",
        message: "permission denied for function apply_user_permission_overrides_as_system",
      });
    }
    expect(await mutableState()).toEqual(before);
  });

  it("left the bystander company untouched", async () => {
    expect(
      await sqlJson(`select json_build_object(
        'overrides', (select count(*) from public.user_permission_overrides o join public.users u on u.id = o.user_id where u.company_id = '${id("b000")}'),
        'deliveries', (select count(*) from public.user_permission_change_deliveries where company_id = '${id("b000")}'),
        'lead', (select json_build_array(assigned_to, assignment_version) from public.opportunities where id = '${LEAD.bystander}'),
        'events', (select count(*) from public.opportunity_assignment_events where company_id = '${id("b000")}')
      )`)
    ).toEqual({ overrides: 0, deliveries: 0, lead: [JULIET, 1], events: 1 });
  });

  it("keeps the editor, the route and the database on one registry and one order", async () => {
    const database = await sqlJson<Array<{ permission: string; scopes: string[] }>>(
      "select json_agg(json_build_object('permission', permission, 'scopes', scopes) order by permission) from private.lead_permission_editor_registry"
    );
    const editor = PERMISSION_EDITOR_REGISTRY.map((action) => ({
      permission: action.id,
      scopes: [...action.scopes],
    }));
    // The route validates against the editor registry, the save against the
    // database registry: they must be the same list with the same scopes.
    expect(new Map(editor.map((entry) => [entry.permission, [...entry.scopes].sort()]))).toEqual(
      new Map(database.map((entry) => [entry.permission, [...entry.scopes].sort()]))
    );
    // The editor sorts with localeCompare, the route demands strictly
    // ascending code units, and the save compares against the database's own
    // collation. One order for every permission, or some saves bounce.
    const ids = editor.map((entry) => entry.permission);
    const byLocale = [...ids].sort((a, b) => a.localeCompare(b));
    const byCodeUnit = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(byCodeUnit).toEqual(byLocale);
    expect(database.map((entry) => entry.permission)).toEqual(byLocale);
  });
});
