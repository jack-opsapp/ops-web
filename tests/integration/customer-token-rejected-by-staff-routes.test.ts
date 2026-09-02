/**
 * Guardrail (design I9, P1 plan Task 5): a broker-minted customer credential
 * is never a staff credential.
 *
 * The staff verifier is Firebase-issuer-pinned and untouched. This test
 * presents a freshly minted `ops_cs_` credential the three ways a staff
 * route accepts a token — `Authorization: Bearer`, the `ops-auth-token`
 * cookie, and the `__session` cookie — to five representative staff routes
 * and proves each answers 401 before touching any data, that the verifier
 * throws for it, and that no key material is ever fetched for it.
 *
 * The routes under test are real; only the data layer is stubbed, and the
 * stub throws — so a 401 is proof the request died at the auth gate.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "ops-guardrail-test";
  return {
    dataAccess: vi.fn(),
  };
});

function unreachable(name: string): never {
  mocks.dataAccess(name);
  throw new Error(`${name} reached with a customer credential`);
}

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: () => unreachable("getServiceRoleClient"),
}));
vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: () => unreachable("findUserByAuth"),
}));
vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermission: () => unreachable("checkPermission"),
  checkPermissionById: () => unreachable("checkPermissionById"),
  checkPermissionByIdStrict: () => unreachable("checkPermissionByIdStrict"),
  resolvePermissionScopeById: () => unreachable("resolvePermissionScopeById"),
}));

import { mintSessionCredential } from "@/lib/customer-identity/credentials";
import { verifyAdminAuth, verifyAuthToken } from "@/lib/firebase/admin-verify";
import { GET as dashboardPreferencesGet } from "@/app/api/dashboard-preferences/route";
import { GET as invoiceSettingsGet } from "@/app/api/settings/invoice/route";
import { GET as documentTemplatesGet } from "@/app/api/documents/templates/route";
import { GET as duplicatesGet } from "@/app/api/duplicates/route";
import { POST as clientProvenancePost } from "@/app/api/clients/[id]/provenance/route";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";

type Presentation = "bearer" | "ops-auth-token" | "__session";
const PRESENTATIONS: readonly Presentation[] = [
  "bearer",
  "ops-auth-token",
  "__session",
];

function present(
  url: string,
  credential: string,
  how: Presentation,
  init: { method?: string; body?: unknown } = {}
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (how === "bearer") headers.authorization = `Bearer ${credential}`;
  else headers.cookie = `${how}=${credential}`;
  return new NextRequest(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

interface StaffRoute {
  readonly name: string;
  readonly call: (credential: string, how: Presentation) => Promise<Response>;
}

const STAFF_ROUTES: readonly StaffRoute[] = [
  {
    name: "GET /api/dashboard-preferences",
    call: (credential, how) =>
      dashboardPreferencesGet(
        present(
          `http://localhost/api/dashboard-preferences?user_id=${USER_ID}&company_id=${COMPANY_ID}`,
          credential,
          how
        )
      ),
  },
  {
    name: "GET /api/settings/invoice",
    call: (credential, how) =>
      invoiceSettingsGet(
        present(
          `http://localhost/api/settings/invoice?companyId=${COMPANY_ID}`,
          credential,
          how
        )
      ),
  },
  {
    name: "GET /api/documents/templates",
    call: (credential, how) =>
      documentTemplatesGet(
        present(
          `http://localhost/api/documents/templates?companyId=${COMPANY_ID}`,
          credential,
          how
        )
      ),
  },
  {
    name: "GET /api/duplicates",
    call: (credential, how) =>
      duplicatesGet(present("http://localhost/api/duplicates", credential, how)),
  },
  {
    name: "POST /api/clients/[id]/provenance",
    call: (credential, how) =>
      clientProvenancePost(
        present(
          `http://localhost/api/clients/${CLIENT_ID}/provenance`,
          credential,
          how,
          { method: "POST", body: { fields: { name: "Jordan Lee" } } }
        ),
        { params: Promise.resolve({ id: CLIENT_ID }) }
      ),
  },
];

let credential: string;
let consoleError: ReturnType<typeof vi.spyOn>;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  credential = mintSessionCredential();
  mocks.dataAccess.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  consoleError.mockRestore();
  fetchSpy.mockRestore();
});

describe("the staff verifier rejects a customer credential", () => {
  it("mints a credential with the customer prefix and no JWT structure", () => {
    expect(credential.startsWith("ops_cs_")).toBe(true);
    expect(credential.split(".")).toHaveLength(1);
  });

  it("verifyAuthToken throws for it", async () => {
    await expect(verifyAuthToken(credential)).rejects.toThrow();
  });

  it("never logs any part of the credential while rejecting it", async () => {
    await verifyAuthToken(credential).catch(() => undefined);
    const logged = consoleError.mock.calls
      .map((call) => call.map((part) => JSON.stringify(part) ?? String(part)).join(" "))
      .join("\n");
    expect(logged).not.toContain(credential.slice("ops_cs_".length, "ops_cs_".length + 8));
  });

  it("never fetches signing keys for it (rejected structurally, offline)", async () => {
    await verifyAuthToken(credential).catch(() => undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(PRESENTATIONS)("verifyAdminAuth returns null when presented as %s", async (how) => {
    const request = present("http://localhost/api/anything", credential, how);
    await expect(verifyAdminAuth(request)).resolves.toBeNull();
  });
});

describe.each(STAFF_ROUTES)("$name", (route) => {
  it.each(PRESENTATIONS)("answers 401 when the customer credential is presented as %s", async (how) => {
    const res = await route.call(credential, how);
    expect(res.status).toBe(401);
  });

  it.each(PRESENTATIONS)("touches no data before refusing (%s)", async (how) => {
    await route.call(credential, how);
    expect(mocks.dataAccess).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not echo the credential in the refusal body", async () => {
    const res = await route.call(credential, "bearer");
    const text = await res.text();
    expect(text).not.toContain("ops_cs_");
    expect(text).not.toContain(credential.slice(-12));
  });
});
