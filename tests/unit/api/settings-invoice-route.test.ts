import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkPermissionById: vi.fn(),
  findUserByAuth: vi.fn(),
  getServiceRoleClient: vi.fn(),
  verifyAdminAuth: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: mocks.verifyAdminAuth,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: mocks.findUserByAuth,
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: mocks.checkPermissionById,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

import { PUT } from "@/app/api/settings/invoice/route";

type CompanyRow = {
  id: string;
  invoice_settings: Record<string, unknown>;
};

function makeSupabaseDouble(company: CompanyRow) {
  class Query {
    private updatePayload: Record<string, unknown> | null = null;

    select() {
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.updatePayload = payload;
      return this;
    }

    eq() {
      return this;
    }

    async single() {
      return { data: company, error: null };
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?:
        ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      if (this.updatePayload?.invoice_settings) {
        company.invoice_settings = this.updatePayload
          .invoice_settings as Record<string, unknown>;
      }
      return Promise.resolve({ data: null, error: null }).then(
        onfulfilled,
        onrejected
      );
    }
  }

  return {
    from: vi.fn(() => new Query()),
    rpc: vi.fn(
      async (
        name: string,
        args: { p_company_id: string; p_patch: Record<string, unknown> }
      ) => {
        if (name !== "merge_company_invoice_settings") {
          return { data: null, error: { message: "Unexpected RPC" } };
        }
        if (args.p_company_id !== company.id) {
          return { data: null, error: { message: "Company not found" } };
        }
        const financialPatch = args.p_patch.financial_intelligence;
        company.invoice_settings = {
          ...company.invoice_settings,
          ...args.p_patch,
          ...(financialPatch && typeof financialPatch === "object"
            ? {
                financial_intelligence: {
                  ...(company.invoice_settings.financial_intelligence as Record<
                    string,
                    unknown
                  >),
                  ...(financialPatch as Record<string, unknown>),
                },
              }
            : {}),
        };
        return { data: company.invoice_settings, error: null };
      }
    ),
  };
}

function request(config: Record<string, unknown>) {
  return new NextRequest("http://test.local/api/settings/invoice", {
    method: "PUT",
    body: JSON.stringify({ companyId: "company-1", config }),
  });
}

describe("/api/settings/invoice", () => {
  let company: CompanyRow;

  beforeEach(() => {
    vi.clearAllMocks();
    company = {
      id: "company-1",
      invoice_settings: {
        default_payment_terms: "NET-45",
        default_tax_rate: 5,
        auto_suggest_on_completion: true,
        auto_suggest_from_estimate: true,
        high_value_threshold: 9000,
        include_cover_email: true,
        financial_intelligence: {
          enabled: true,
          overdue_pct_threshold: 30,
          concentration_pct_threshold: 55,
        },
      },
    };
    mocks.verifyAdminAuth.mockResolvedValue({
      uid: "auth-1",
      email: "operator@example.com",
    });
    mocks.findUserByAuth.mockResolvedValue({
      id: "user-1",
      company_id: "company-1",
      role: "owner",
    });
    mocks.checkPermissionById.mockResolvedValue(true);
    mocks.getServiceRoleClient.mockReturnValue(makeSupabaseDouble(company));
  });

  it("allows a custom role with settings.billing permission", async () => {
    mocks.findUserByAuth.mockResolvedValue({
      id: "user-1",
      company_id: "company-1",
      role: "dispatcher",
    });

    const response = await PUT(request({ default_payment_terms: "NET-30" }));

    expect(response.status).toBe(200);
    expect(mocks.checkPermissionById).toHaveBeenCalledWith(
      "user-1",
      "settings.billing"
    );
  });

  it("merges a financial-only patch without resetting invoice automation", async () => {
    const response = await PUT(
      request({
        financial_intelligence: {
          enabled: false,
          overdue_pct_threshold: 42,
        },
      })
    );

    expect(response.status).toBe(200);
    expect(company.invoice_settings).toMatchObject({
      default_payment_terms: "NET-45",
      default_tax_rate: 5,
      auto_suggest_on_completion: true,
      auto_suggest_from_estimate: true,
      high_value_threshold: 9000,
      include_cover_email: true,
      financial_intelligence: {
        enabled: false,
        overdue_pct_threshold: 42,
        concentration_pct_threshold: 55,
      },
    });
  });

  it("rejects writes when settings.billing is denied", async () => {
    mocks.checkPermissionById.mockResolvedValue(false);

    const response = await PUT(request({ default_payment_terms: "NET-15" }));

    expect(response.status).toBe(403);
    expect(company.invoice_settings.default_payment_terms).toBe("NET-45");
  });

  it("rejects a patch that contains no supported settings", async () => {
    const response = await PUT(request({ unknown_setting: true }));

    expect(response.status).toBe(400);
    expect(company.invoice_settings.default_payment_terms).toBe("NET-45");
  });
});
