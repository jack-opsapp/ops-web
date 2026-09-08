// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { getMcpServerRuntime, type McpServerRuntime } from "../runtime";
const bridge = vi.hoisted(() => ({
  rpc: undefined as unknown as (
    name: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }> & {
    abortSignal?: (
      signal: AbortSignal
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  },
  from: undefined as unknown as (table: string) => unknown,
  user: "10000000-0000-4000-8000-000000000001",
  company: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}));
vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => bridge,
}));
// Only the external signed-in identity provider is replaced; all policy, OAuth,
// bearer, financial authorization, SQL and approval implementations are real.
vi.mock("@/app/api/agent/_lib/auth", () => ({
  authenticateRequest: async () => ({
    id: bridge.user,
    companyId: bridge.company,
  }),
  isErrorResponse: () => false,
}));
vi.mock("@/lib/supabase/helpers", () => ({
  requireSupabase: () => bridge,
  parseDate: (value: string | null) => (value ? new Date(value) : null),
}));
import { POST as contextPost } from "@/app/api/mcp/oauth/authorize/context/route";
import { POST as decisionPost } from "@/app/api/mcp/oauth/authorize/decision/route";
import { POST as tokenPost } from "@/app/api/mcp/oauth/token/route";
import { POST as policyPost } from "@/app/api/agent/financial-policy/route";
import { POST as registerPost } from "@/app/api/mcp/oauth/register/route";
import { resolveMcpBearer } from "../bearer";
import { createMcpHandler } from "../sdk";
import { createOpsMcpServer } from "../server-factory";
import { resolveMcpOAuthConfig } from "../oauth";
import { MCP_FINANCIAL_TRIAL_EXPOSURE } from "../../registry/mcp-exposure-catalog";
import { ApprovalQueueService } from "@/lib/api/services/approval-queue-service";
import { server as mockNetwork } from "../../../../../tests/mocks/server";

type Json = Record<string, any>;
const database = process.env.OPS_P16_PROTOCOL_DATABASE;
const USER = bridge.user,
  COMPANY = bridge.company;
const OTHER = "10000000-0000-4000-8000-000000000002";
const OTHER_COMPANY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOTE = "40000000-0000-4000-8000-000000000001";
const HISTORY = "90000000-0000-4000-8000-000000000002";
const EXPOSURE = MCP_FINANCIAL_TRIAL_EXPOSURE.revision;
const CONSENT = "2026-09-07.mcp-consent-catalog.v12";
const scopes = [...MCP_FINANCIAL_TRIAL_EXPOSURE.grantableScopes];
const run = promisify(execFile);
const literal = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value))
    return "array[" + value.map(literal).join(",") + "]::text[]";
  if (typeof value === "object")
    return literal(JSON.stringify(value)) + "::jsonb";
  return "'" + String(value).replaceAll("'", "''") + "'";
};
async function sql(statement: string, signal?: AbortSignal): Promise<any> {
  if (!database || !/^ops_p16_[0-9]+_[0-9]+$/.test(database))
    throw new Error("LOCAL_FIXTURE_ONLY");
  const { stdout } = await run(
    "/opt/homebrew/opt/postgresql@17/bin/psql",
    [
      "-X",
      "-qAt",
      "-h",
      "/private/tmp/ops-editorial-pg/socket",
      "-p",
      "55439",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "set request.jwt.claim.role='service_role';set timezone='UTC';" +
        statement,
    ],
    { maxBuffer: 4 * 1024 * 1024, signal }
  );
  const value = stdout.trim();
  return value ? JSON.parse(value) : null;
}
let metadata: Json[] = [];
async function executeRpc(
  name: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal
) {
  if (
    !/^[a-z_]+$/.test(name) ||
    Object.keys(args).some((k) => !/^p_[a-z0-9_]+$/.test(k))
  )
    throw new Error("bad RPC");
  const meta = metadata.find(
    (m) =>
      m.name === name &&
      m.args.length === Object.keys(args).length &&
      m.args.every((k: string) => k in args)
  );
  if (!meta)
    throw new Error(
      "Missing real RPC: " + name + "(" + Object.keys(args).join(",") + ")"
    );
  try {
    const call =
      "public." +
      name +
      "(" +
      Object.entries(args)
        .map(([k, v]) => k + "=>" + literal(v))
        .join(",") +
      ")";
    const data = await sql(
      meta.set
        ? "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from " + call + " r"
        : "select to_jsonb(" + call + ")",
      signal
    );
    return { data, error: null };
  } catch (error) {
    const message = String((error as { stderr?: string }).stderr ?? error);
    return {
      data: null,
      error: { message: message.match(/ERROR:\s+([^\n]+)/)?.[1] ?? message },
    };
  }
}
function rpc(name: string, args: Record<string, unknown> = {}) {
  let pending: ReturnType<typeof executeRpc> | undefined;
  return {
    then<T = Awaited<ReturnType<typeof executeRpc>>, U = never>(
      resolve?:
        | ((r: Awaited<ReturnType<typeof executeRpc>>) => T | PromiseLike<T>)
        | null,
      reject?: ((e: unknown) => U | PromiseLike<U>) | null
    ) {
      pending ??= executeRpc(name, args);
      return pending.then(resolve, reject);
    },
    abortSignal: (signal: AbortSignal) => executeRpc(name, args, signal),
  };
}
async function mustRpc(
  name: string,
  args: Record<string, unknown> = {}
): Promise<any> {
  const r = await rpc(name, args);
  if (r.error) throw new Error(name + ": " + r.error.message);
  return r.data;
}
// Local PostgREST-shaped read adapter used by the actual OPS approval service.
function from(table: string) {
  if (table !== "agent_actions")
    throw new Error("Unexpected approval table " + table);
  const filters: string[] = [];
  const execute = async (single = false) => {
    const rows = await sql(
      "select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.agent_actions r where " +
        (filters.join(" and ") || "true")
    );
    return { data: single ? (rows[0] ?? null) : rows, error: null };
  };
  const b = {
    select: () => b,
    eq: (k: string, v: unknown) => {
      if (!/^[a-z_]+$/.test(k)) throw new Error("bad field");
      filters.push(k + "=" + literal(v));
      return b;
    },
    limit: () => b,
    single: () => execute(true),
    maybeSingle: () => execute(true),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      execute().then(resolve, reject),
  };
  return b;
}
let server: Server, origin: string, policy: Json, runtime: McpServerRuntime;
let serial = 0;
async function post(path: string, body: unknown, token?: string, form = false) {
  return fetch(origin + path, {
    method: "POST",
    headers: {
      "content-type": form
        ? "application/x-www-form-urlencoded"
        : "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
      accept: "application/json, text/event-stream",
    },
    body: form
      ? new URLSearchParams(body as Record<string, string>).toString()
      : JSON.stringify(body),
  });
}
async function payload(response: Response): Promise<Json> {
  const raw = await response.text();
  const event = raw
    .split(/\r?\n/)
    .find((l) => l.startsWith("data:"))
    ?.slice(5)
    .trim();
  return JSON.parse(event ?? raw);
}
async function host(token: string, method: string, params?: unknown) {
  return post(
    "/api/mcp",
    { jsonrpc: "2.0", id: ++serial, method, ...(params ? { params } : {}) },
    token
  );
}
function unwrap(result: Json): Json {
  return JSON.parse(result.result.content[0].text);
}
async function register(extra: string[] = []) {
  const rows = await mustRpc("register_mcp_oauth_client_as_system", {
    p_client_name: "Fictional local financial host " + ++serial,
    p_redirect_uris: [origin + "/callback/financial-trial"],
    p_scope: [...scopes, ...extra].sort().join(" "),
    p_scope_ceiling: [...scopes, ...extra].sort(),
    p_consent_catalog_revision: CONSENT,
    p_exposure_revision: EXPOSURE,
    p_software_id: null,
    p_software_version: null,
  });
  return rows[0];
}
async function bind(client: Json, overrides: Json = {}) {
  return rpc("provision_mcp_oauth_canary_as_system", {
    p_oauth_client_id: client.client_id,
    p_user_id: USER,
    p_company_id: COMPANY,
    p_exposure_revision: EXPOSURE,
    p_consent_catalog_revision: CONSENT,
    p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    p_financial_policy_id: policy.policy_id,
    p_financial_policy_sha256: policy.policy_sha256,
    p_financial_effect_revision: await sql(
      "select to_jsonb(private.financial_document_effect_revision())"
    ),
    ...overrides,
  });
}
async function context(client: Json, extra: Json = {}) {
  const verifier =
    "fictional-local-verifier-" + String(++serial).padStart(48, "0");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const response = await post("/authorize/context", {
    client_id: client.client_id,
    redirect_uri: origin + "/callback/financial-trial",
    response_type: "code",
    scope: scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "fictional-state",
    resource: resolveMcpOAuthConfig().resource,
    ...extra,
  });
  return { verifier, response, data: await payload(response) };
}
async function authorize(client: Json) {
  const ctx = await context(client);
  expect(ctx.response.status, JSON.stringify(ctx.data)).toBe(200);
  expect(ctx.data.exposureRevision).toBe(EXPOSURE);
  expect(ctx.data.scopes.map((x: Json) => x.scope)).toEqual(scopes);
  expect(
    ctx.data.scopes.find(
      (x: Json) => x.scope === "ops.financial_documents.prepare"
    ).label
  ).toContain("never send or issue");
  const decision = await post("/authorize/decision", {
    consent_preview: ctx.data.consentPreview,
    decision: "approve",
  });
  const result = await payload(decision);
  expect(decision.status, JSON.stringify(result)).toBe(200);
  const redirect = new URL(result.redirect_to);
  expect(redirect.searchParams.get("state")).toBe("fictional-state");
  return {
    code: redirect.searchParams.get("code")!,
    verifier: ctx.verifier,
    preview: ctx.data.consentPreview,
  };
}
async function exchange(client: Json, auth: Json, extra: Json = {}) {
  return post(
    "/token",
    {
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: auth.code,
      redirect_uri: origin + "/callback/financial-trial",
      code_verifier: auth.verifier,
      resource: resolveMcpOAuthConfig().resource,
      ...extra,
    },
    undefined,
    true
  );
}
async function connected() {
  const client = await register();
  const binding = await bind(client);
  expect(binding.error).toBeNull();
  const auth = await authorize(client);
  const response = await exchange(client, auth);
  const token = await payload(response);
  expect(response.status, JSON.stringify(token)).toBe(200);
  return { client, auth, token };
}
async function refresh(client: Json, token: Json) {
  return post(
    "/token",
    {
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: token.refresh_token,
      resource: resolveMcpOAuthConfig().resource,
    },
    undefined,
    true
  );
}
async function request(key: string) {
  const req = await sql("select financial_test.request(" + literal(key) + ")");
  const source = await sql(
    "select jsonb_build_object('kind','historical_line','reference_id',l.id,'sha256',private.financial_document_hash(to_jsonb(l)),'unit_price',null,'minimum_charge',null) from public.line_items l where id=" +
      literal(HISTORY)
  );
  return {
    ...req,
    title: "New fictional deck",
    lines: [
      {
        name: "Deck labour",
        description: "",
        quantity: "2",
        unit: "hour",
        type: "LABOR",
        source,
        discount_percent: "0",
        is_taxable: true,
      },
    ],
  };
}
async function disable(client: Json) {
  return mustRpc("disable_mcp_oauth_canary_as_system", {
    p_oauth_client_id: client.client_id,
    p_user_id: USER,
    p_company_id: COMPANY,
  });
}

describe.skipIf(!database)(
  "Phase16 real local financial OAuth / HTTP / SQL acceptance",
  () => {
    beforeAll(async () => {
      mockNetwork.close();
      metadata = await sql(
        "select jsonb_agg(jsonb_build_object('name',p.proname,'args',coalesce(p.proargnames[1:p.pronargs],'{}'),'set',p.proretset)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"
      );
      bridge.rpc = rpc;
      bridge.from = from;
      vi.stubEnv("OPS_AGENT_OPERATIONAL_READ_CURSOR_KEY", "1".repeat(64));
      runtime = getMcpServerRuntime();
      server = createServer(async (req, res) => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const body = Buffer.concat(chunks);
          const request = new NextRequest(origin + req.url, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            ...(body.length ? { body } : {}),
          });
          let response: Response;
          if (req.url === "/api/mcp") {
            const auth = await resolveMcpBearer(request, runtime);
            if (auth.kind !== "authenticated")
              response = Response.json({ error: auth.kind }, { status: 401 });
            else
              response = await createMcpHandler(
                (ctx) =>
                  createOpsMcpServer({
                    requestId: auth.requestId,
                    actorContext: auth.actorContext,
                    grantFacts: auth.grantFacts,
                    protocolEra: ctx.era,
                    domainService: runtime.domainService,
                    auditRpcClient: bridge,
                    durableRateLimiter: runtime.durableRateLimiter,
                  }),
                { legacy: "stateless" }
              ).fetch(request);
          } else {
            const routes: Record<
              string,
              (r: NextRequest) => Promise<Response>
            > = {
              "/authorize/context": contextPost,
              "/authorize/decision": decisionPost,
              "/token": tokenPost,
              "/policy": policyPost,
              "/register": registerPost,
            };
            if (!routes[req.url!]) throw new Error("Unknown local route");
            response = await routes[req.url!](request);
          }
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ fixture_error: String(error) }));
        }
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve)
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("loopback unavailable");
      origin = "http://127.0.0.1:" + address.port;
      // Deliberately use the actual configured issuer/audience; only loopback is fetched.
      const source = await sql(
        "select to_jsonb(n)||jsonb_build_object('sha256',private.financial_document_hash(to_jsonb(n))) from public.project_notes n where id=" +
          literal(NOTE)
      );
      const response = await post("/policy", {
        action: "preview",
        policy: {
          revision: "fictional-local-p16",
          source_document_id: NOTE,
          source_sha256: source.sha256,
          expected_policy_sha256: null,
          currency_code: "CAD",
          terms: "Payment on completion",
          permitted_units: ["hour"],
          permitted_price_sources: ["historical_line", "operator", "catalog"],
        },
      });
      const preview = await payload(response);
      expect(response.status, JSON.stringify(preview)).toBe(200);
      const enrolled = await post("/policy", {
        action: "enroll",
        preview_id: preview.preview_id,
        preview_sha256: preview.preview_sha256,
      });
      policy = await payload(enrolled);
      expect(enrolled.status, JSON.stringify(policy)).toBe(200);
      expect(policy.financial_documents_created).toBe(0);
    }, 60000);
    afterAll(async () => {
      server?.closeAllConnections();
      await new Promise<void>((resolve) =>
        server ? server.close(() => resolve()) : resolve()
      );
    });
    it("keeps public registration v14/v9 and refuses unbound or expanded financial subjects", async () => {
      expect(
        await sql(
          "select to_jsonb(has_function_privilege('authenticated','public.provision_mcp_oauth_canary_as_system(uuid,uuid,uuid,text,text,timestamptz,uuid,text,text)','execute'))"
        )
      ).toBe(false);
      expect(
        await sql(
          "select to_jsonb(has_table_privilege('service_role','private.mcp_oauth_canary_bindings','insert,update,delete'))"
        )
      ).toBe(false);
      const publicResponse = await post("/register", {
        client_name: "Ordinary fictional host",
        redirect_uris: [origin + "/callback/public-trial"],
      });
      const publicClient = await payload(publicResponse);
      expect(publicResponse.status, JSON.stringify(publicClient)).toBe(201);
      const current = await sql(
        "select to_jsonb(c) from private.mcp_oauth_clients c where client_id=" +
          literal(publicClient.client_id)
      );
      expect(current.exposure_revision).toBe("2026-09-04.mcp-exposure.v14");
      expect(current.consent_catalog_revision).toBe(
        "2026-09-04.mcp-consent-catalog.v9"
      );
      const client = await register();
      expect((await context(client)).response.status).toBe(400);
      expect(
        (await bind(client, { p_user_id: OTHER, p_company_id: OTHER_COMPANY }))
          .error
      ).not.toBeNull();
      expect(
        (
          await bind(client, {
            p_expires_at: new Date(Date.now() + 3 * 3600000).toISOString(),
          })
        ).error
      ).not.toBeNull();
      expect(
        (await bind(await register(["ops.tasks.read"]))).error
      ).not.toBeNull();
      expect((await bind(client)).error).toBeNull();
      bridge.company = OTHER_COMPANY;
      expect((await context(client)).response.status).toBe(400);
      bridge.company = COMPANY;
      bridge.user = OTHER;
      expect((await context(client)).response.status).toBe(400);
      bridge.user = USER;
      expect(
        (await context(client, { scope: scopes.join(" ") + " ops.tasks.read" }))
          .response.status
      ).toBe(400);
      await disable(client);
    }, 60000);
    it("completes owner enrollment, fresh consent, PKCE exchange, protocol discovery, historical +8%, exact OPS approval and one held draft", async () => {
      const { client, auth, token } = await connected();
      expect(
        (
          await post("/authorize/decision", {
            consent_preview: auth.preview,
            decision: "approve",
          })
        ).status
      ).toBe(400);
      const init = await payload(
        await host(token.access_token, "initialize", {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "Fictional local host", version: "1" },
        })
      );
      expect(init.result, JSON.stringify(init)).toBeDefined();
      expect(init.result.serverInfo.name).toBeTruthy();
      const listed = await payload(
        await host(token.access_token, "tools/list")
      );
      expect(listed.result.tools.map((t: Json) => t.name)).toEqual(
        MCP_FINANCIAL_TRIAL_EXPOSURE.toolIds
      );
      const companyResult = await payload(
        await host(token.access_token, "tools/call", {
          name: "get_company_context",
          arguments: {},
        })
      );
      expect(
        companyResult.result.isError,
        JSON.stringify(companyResult)
      ).not.toBe(true);
      expect(JSON.stringify(unwrap(companyResult))).toContain(
        "OPS FICTIONAL FINANCIAL TRIAL"
      );
      const denied = await payload(
        await host(token.access_token, "tools/call", {
          name: "send_invoice",
          arguments: {},
        })
      );
      expect(denied.error).toBeDefined();
      const inspected = await payload(
        await host(token.access_token, "tools/call", {
          name: "inspect_financial_document",
          arguments: {
            client_id: "20000000-0000-4000-8000-000000000001",
            project_id: "30000000-0000-4000-8000-000000000001",
            opportunity_id: null,
            product_ids: [],
            historical_line_ids: [HISTORY],
            estimate_ids: [],
            project_note_ids: [NOTE],
          },
        })
      );
      if (inspected.result.isError) {
        const authn = await resolveMcpBearer(
          new Request(origin + "/api/mcp", {
            headers: { authorization: "Bearer " + token.access_token },
          }),
          runtime
        );
        if (authn.kind === "authenticated") {
          try {
            await runtime.financialDocument.inspectFinancialDocument(
              authn.actorContext,
              {
                client_id: "20000000-0000-4000-8000-000000000001",
                project_id: "30000000-0000-4000-8000-000000000001",
                opportunity_id: null,
                product_ids: [],
                historical_line_ids: [HISTORY],
                estimate_ids: [],
                project_note_ids: [NOTE],
              }
            );
          } catch (error) {
            const e = error as {
              auditReasonForLog?: () => string;
              cause?: unknown;
            };
            throw new Error(
              "Financial inspection diagnostic: " +
                (e.auditReasonForLog?.() ?? String(error)),
              { cause: e.cause }
            );
          }
        }
      }
      expect(inspected.result.isError, JSON.stringify(inspected)).not.toBe(
        true
      );
      const req = await request("protocol-golden");
      const prepared = await payload(
        await host(token.access_token, "tools/call", {
          name: "prepare_financial_document",
          arguments: req,
        })
      );
      expect(prepared.result.isError, JSON.stringify(prepared)).not.toBe(true);
      const proposal = unwrap(prepared);
      expect(proposal.proposal.subtotal).toBe("216.00");
      expect(proposal.proposal.total).toBe("226.80");
      expect(
        await sql(
          "select to_jsonb(count(*)) from public.estimates where distribution_hold"
        )
      ).toBe(0);
      const replay = unwrap(
        await payload(
          await host(token.access_token, "tools/call", {
            name: "prepare_financial_document",
            arguments: req,
          })
        )
      );
      expect(replay.replayed).toBe(true);
      const confirmation = {
        change_set_id: proposal.change_set_id,
        preview_sha256: proposal.preview_sha256,
      };
      await expect(
        ApprovalQueueService.approveAction(
          proposal.action_id,
          COMPANY,
          OTHER,
          confirmation
        )
      ).rejects.toThrow();
      await expect(
        ApprovalQueueService.approveAction(proposal.action_id, COMPANY, USER, {
          ...confirmation,
          preview_sha256: "sha256:" + "0".repeat(64),
        })
      ).rejects.toThrow();
      await ApprovalQueueService.approveAction(
        proposal.action_id,
        COMPANY,
        USER,
        confirmation
      );
      await ApprovalQueueService.approveAction(
        proposal.action_id,
        COMPANY,
        USER,
        confirmation
      );
      const state = await sql(
        "select jsonb_build_object('held',(select count(*) from public.estimates where distribution_hold),'total',(select total from public.estimates where distribution_hold),'status',(select status from public.estimates where distribution_hold),'numbers',(select sum(last_number) from public.document_sequences),'sync',(select count(*) from public.accounting_sync_queue q join public.estimates e on e.id=q.entity_id where e.distribution_hold),'receipt',(select execution_result from public.agent_actions where id=" +
          literal(proposal.action_id) +
          "))"
      );
      expect(state.held).toBe(1);
      expect(state.total).toBe(226.8);
      expect(state.status).toBe("draft");
      expect(state.numbers).toBe(1);
      expect(state.sync).toBe(0);
      console.info(
        "FINANCIAL_TRIAL_EVIDENCE",
        JSON.stringify({
          fixture_only: true,
          external_host_authenticated: false,
          company_id: COMPANY,
          actor_user_id: USER,
          oauth_client_id: client.client_id,
          exposure_revision: EXPOSURE,
          consent_catalog_revision: CONSENT,
          scope_ceiling: scopes,
          policy_id: policy.policy_id,
          policy_sha256: policy.policy_sha256,
          effect_revision: await sql(
            "select to_jsonb(private.financial_document_effect_revision())"
          ),
          observed: state,
        })
      );
      expect(
        await sql(
          "select to_jsonb(user_id) from public.agent_actions where id=" +
            literal(proposal.action_id)
        )
      ).toBe(USER);
      const rotatedResponse = await refresh(client, token);
      const rotated = await payload(rotatedResponse);
      expect(rotatedResponse.status, JSON.stringify(rotated)).toBe(200);
      expect((await host(rotated.access_token, "tools/list")).status).toBe(200);
      expect((await refresh(client, token)).status).toBe(400);
      expect((await host(rotated.access_token, "tools/list")).status).toBe(401);
      expect((await exchange(client, auth)).status).toBe(400);
      await disable(client);
    }, 120000);
    it("rejects bad PKCE and revoked consent between preview, decision and code exchange", async () => {
      const client = await register();
      expect((await bind(client)).error).toBeNull();
      const auth = await authorize(client);
      expect(
        (await exchange(client, auth, { code_verifier: "x".repeat(64) })).status
      ).toBe(400);
      expect((await exchange(client, auth)).status).toBe(400);
      const pending = await context(client);
      const secondAuth = await authorize(client);
      await disable(client);
      expect(
        (
          await post("/authorize/decision", {
            consent_preview: pending.data.consentPreview,
            decision: "approve",
          })
        ).status
      ).toBe(400);
      expect(
        (await exchange(client, secondAuth)).status
      ).toBeGreaterThanOrEqual(400);
    }, 60000);
    it("invalidates issued bearers on policy source, tax, owner and effect drift, with no additional financial rows", async () => {
      const { client, token } = await connected();
      const source = await sql(
        "select to_jsonb(content) from public.project_notes where id=" +
          literal(NOTE)
      );
      const before = await sql(
        "select jsonb_build_array((select count(*) from public.estimates),(select sum(last_number) from public.document_sequences))"
      );
      for (const [change, restore] of [
        [
          "update public.project_notes set content='Fictional changed rules' where id=" +
            literal(NOTE),
          "update public.project_notes set content=" +
            literal(source) +
            " where id=" +
            literal(NOTE),
        ],
        [
          "update public.tax_rates set rate=.06",
          "update public.tax_rates set rate=.05",
        ],
        [
          "update public.companies set account_holder_id=" +
            literal(OTHER) +
            " where id=" +
            literal(COMPANY),
          "update public.companies set account_holder_id=" +
            literal(USER) +
            " where id=" +
            literal(COMPANY),
        ],
        [
          "create function public.p16_fictional_effect_drift() returns int language sql as 'select 1'",
          "drop function public.p16_fictional_effect_drift()",
        ],
      ]) {
        await sql(change);
        expect((await host(token.access_token, "tools/list")).status).toBe(401);
        await sql(restore);
        expect((await host(token.access_token, "tools/list")).status).toBe(200);
      }
      expect(
        await sql(
          "select jsonb_build_array((select count(*) from public.estimates),(select sum(last_number) from public.document_sequences))"
        )
      ).toEqual(before);
      expect(
        await mustRpc("disable_mcp_oauth_canary_as_system", {
          p_oauth_client_id: client.client_id,
          p_user_id: OTHER,
          p_company_id: COMPANY,
        })
      ).toBe(false);
      expect((await host(token.access_token, "tools/list")).status).toBe(200);
      await disable(client);
      expect((await host(token.access_token, "tools/list")).status).toBe(401);
      expect((await refresh(client, token)).status).toBeGreaterThanOrEqual(400);
    }, 120000);
    it("expires real issued tokens and prevents extending or substituting the exact binding", async () => {
      const client = await register(),
        expires = Date.now() + 6000;
      expect(
        (await bind(client, { p_expires_at: new Date(expires).toISOString() }))
          .error
      ).toBeNull();
      const auth = await authorize(client);
      const response = await exchange(client, auth);
      const token = await payload(response);
      expect(response.status, JSON.stringify(token)).toBe(200);
      await expect(
        sql(
          "update private.mcp_oauth_canary_bindings set expires_at=expires_at+interval '1 minute' where oauth_client_id=" +
            literal(client.client_id)
        )
      ).rejects.toThrow();
      await expect(
        sql(
          "update private.mcp_oauth_canary_bindings set user_id=" +
            literal(OTHER) +
            " where oauth_client_id=" +
            literal(client.client_id)
        )
      ).rejects.toThrow();
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, expires - Date.now() + 50))
      );
      expect((await host(token.access_token, "tools/list")).status).toBe(401);
      expect((await context(client)).response.status).toBe(400);
      expect((await refresh(client, token)).status).toBe(400);
      await disable(client);
    }, 60000);
    it("fences a prepared approval against revocation, including racing local calls and receipt replay", async () => {
      const { client, token } = await connected();
      const prepared = await payload(
        await host(token.access_token, "tools/call", {
          name: "prepare_financial_document",
          arguments: await request("pending-trial-revocation"),
        })
      );
      expect(prepared.result.isError, JSON.stringify(prepared)).not.toBe(true);
      const proposal = unwrap(prepared);
      const confirmation = {
        change_set_id: proposal.change_set_id,
        preview_sha256: proposal.preview_sha256,
      };
      const races = await Promise.allSettled([
        ApprovalQueueService.approveAction(
          proposal.action_id,
          COMPANY,
          USER,
          confirmation
        ),
        disable(client),
      ]);
      // Whichever transaction gets the shared client fence first determines the
      // outcome; an already-saved draft stays held and all later attempts fail.
      if (races[1].status === "rejected") await disable(client);
      expect((await host(token.access_token, "tools/list")).status).toBe(401);
      await expect(
        ApprovalQueueService.approveAction(
          proposal.action_id,
          COMPANY,
          USER,
          confirmation
        )
      ).rejects.toThrow();
      const state = await sql(
        "select jsonb_build_object('count',(select count(*) from public.estimates where distribution_hold),'escaped',(select count(*) from public.estimates where title='New fictional deck' and (not distribution_hold or status<>'draft')),'tokens',(select count(*) from private.mcp_oauth_tokens t join private.mcp_oauth_grants g on g.id=t.grant_id where g.client_id=" +
          literal(client.client_id) +
          " and t.revoked_at is null))"
      );
      expect(state.count).toBeLessThanOrEqual(2);
      expect(state.escaped).toBe(0);
      expect(state.tokens).toBe(0);
    }, 120000);
    it("retires enrolled rules through the owner API and blocks a previously prepared approval without releasing holds", async () => {
      const { client, token } = await connected();
      const prepared = await payload(
        await host(token.access_token, "tools/call", {
          name: "prepare_financial_document",
          arguments: await request("pending-owner-retirement"),
        })
      );
      expect(prepared.result.isError, JSON.stringify(prepared)).not.toBe(true);
      const proposal = unwrap(prepared);
      const before = await sql(
        "select jsonb_build_array((select count(*) from public.estimates),(select sum(last_number) from public.document_sequences),(select count(*) from public.estimates where distribution_hold))"
      );
      const response = await post("/policy", {
        action: "revoke",
        policy_id: policy.policy_id,
        policy_sha256: policy.policy_sha256,
      });
      const receipt = await payload(response);
      expect(response.status, JSON.stringify(receipt)).toBe(200);
      expect(receipt.financial_documents_created).toBe(0);
      expect((await host(token.access_token, "tools/list")).status).toBe(401);
      await expect(
        ApprovalQueueService.approveAction(proposal.action_id, COMPANY, USER, {
          change_set_id: proposal.change_set_id,
          preview_sha256: proposal.preview_sha256,
        })
      ).rejects.toThrow();
      expect(
        await sql(
          "select jsonb_build_array((select count(*) from public.estimates),(select sum(last_number) from public.document_sequences),(select count(*) from public.estimates where distribution_hold))"
        )
      ).toEqual(before);
      await disable(client);
    }, 120000);
  }
);
