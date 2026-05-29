import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/settings/lifecycle/route";

const {
  findUserByAuthMock,
  getServiceRoleClientMock,
  verifyAdminAuthMock,
  checkPermissionByIdMock,
} = vi.hoisted(() => ({
  findUserByAuthMock: vi.fn(),
  getServiceRoleClientMock: vi.fn(),
  verifyAdminAuthMock: vi.fn(),
  checkPermissionByIdMock: vi.fn(),
}));

vi.mock("@/lib/firebase/admin-verify", () => ({
  verifyAdminAuth: verifyAdminAuthMock,
}));

vi.mock("@/lib/supabase/find-user-by-auth", () => ({
  findUserByAuth: findUserByAuthMock,
}));

vi.mock("@/lib/supabase/check-permission", () => ({
  checkPermissionById: checkPermissionByIdMock,
}));

vi.mock("@/lib/supabase/server-client", () => ({
  getServiceRoleClient: getServiceRoleClientMock,
}));

type SettingsRouteState = {
  lead_lifecycle_settings: Array<Record<string, unknown>>;
};

function makeSupabaseDouble(state: SettingsRouteState) {
  class Query {
    private filters = new Map<string, unknown>();
    private upsertPayload: Record<string, unknown> | null = null;

    constructor(private readonly table: keyof SettingsRouteState) {}

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.set(column, value);
      return this;
    }

    upsert(payload: Record<string, unknown>) {
      this.upsertPayload = payload;
      return this;
    }

    async single() {
      const rows = state[this.table].filter((row) => this.matches(row));
      return { data: rows[0] ?? null, error: null };
    }

    private matches(row: Record<string, unknown>) {
      for (const [column, value] of this.filters.entries()) {
        if (row[column] !== value) return false;
      }
      return true;
    }

    private result() {
      if (this.upsertPayload) {
        const rows = state[this.table];
        const existing = rows.find(
          (row) => row.company_id === this.upsertPayload?.company_id
        );
        if (existing) {
          Object.assign(existing, this.upsertPayload);
        } else {
          rows.push({ ...this.upsertPayload });
        }
        return { data: this.upsertPayload, error: null };
      }
      return {
        data: state[this.table].filter((row) => this.matches(row)),
        error: null,
      };
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ) {
      return Promise.resolve(this.result()).then(onfulfilled, onrejected);
    }
  }

  return {
    from(table: string) {
      return new Query(table as keyof SettingsRouteState);
    },
  };
}

describe("/api/settings/lifecycle", () => {
  beforeEach(() => {
    verifyAdminAuthMock.mockResolvedValue({
      uid: "auth-1",
      email: "owner@example.com",
    });
    findUserByAuthMock.mockResolvedValue({
      id: "user-1",
      company_id: "company-1",
    });
    checkPermissionByIdMock.mockResolvedValue(true);
  });

  it("reads lead_lifecycle_settings instead of companies.lifecycle_settings", async () => {
    const state: SettingsRouteState = {
      lead_lifecycle_settings: [
        {
          company_id: "company-1",
          follow_up_after_days: 9,
          second_follow_up_archive_after_days: 12,
          no_correspondence_archive_days: 21,
          inbound_unreplied_lost_days: 34,
          follow_up_template_subject: "",
          follow_up_template_body: "Checking in on {{first_name}}.",
          auto_archive_enabled: true,
          auto_lost_enabled: false,
        },
      ],
    };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const response = await GET(
      new NextRequest(
        "http://test.local/api/settings/lifecycle?companyId=company-1"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.config).toMatchObject({
      follow_up_after_days: 9,
      second_follow_up_archive_after_days: 12,
      no_correspondence_archive_days: 21,
      inbound_unreplied_lost_days: 34,
      follow_up_template_subject: "Following up",
      follow_up_template_body: "Checking in on {{first_name}}.",
      auto_archive_enabled: true,
      auto_lost_enabled: false,
    });
  });

  it("upserts sanitized lead_lifecycle_settings rows", async () => {
    const state: SettingsRouteState = { lead_lifecycle_settings: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const response = await PUT(
      new NextRequest("http://test.local/api/settings/lifecycle", {
        method: "PUT",
        body: JSON.stringify({
          companyId: "company-1",
          config: {
            follow_up_after_days: 0,
            second_follow_up_archive_after_days: 8,
            no_correspondence_archive_days: 14,
            inbound_unreplied_lost_days: 30,
            follow_up_template_subject: "",
            follow_up_template_body: "Body",
            auto_archive_enabled: true,
            auto_lost_enabled: false,
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(state.lead_lifecycle_settings[0]).toMatchObject({
      company_id: "company-1",
      follow_up_after_days: 1,
      second_follow_up_archive_after_days: 8,
      no_correspondence_archive_days: 14,
      inbound_unreplied_lost_days: 30,
      follow_up_template_subject: "Following up",
      follow_up_template_body: "Body",
      auto_archive_enabled: true,
      auto_lost_enabled: false,
    });
  });

  it("authorizes via the settings.company granular permission, never by role", async () => {
    const state: SettingsRouteState = { lead_lifecycle_settings: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    await GET(
      new NextRequest(
        "http://test.local/api/settings/lifecycle?companyId=company-1"
      )
    );

    expect(checkPermissionByIdMock).toHaveBeenCalledWith(
      "user-1",
      "settings.company"
    );
  });

  it("rejects GET when the user lacks settings.company", async () => {
    checkPermissionByIdMock.mockResolvedValue(false);
    const state: SettingsRouteState = { lead_lifecycle_settings: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const response = await GET(
      new NextRequest(
        "http://test.local/api/settings/lifecycle?companyId=company-1"
      )
    );

    expect(response.status).toBe(403);
  });

  it("rejects PUT when the user lacks settings.company and writes nothing", async () => {
    checkPermissionByIdMock.mockResolvedValue(false);
    const state: SettingsRouteState = { lead_lifecycle_settings: [] };
    getServiceRoleClientMock.mockReturnValue(makeSupabaseDouble(state));

    const response = await PUT(
      new NextRequest("http://test.local/api/settings/lifecycle", {
        method: "PUT",
        body: JSON.stringify({
          companyId: "company-1",
          config: { follow_up_after_days: 5 },
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(state.lead_lifecycle_settings).toHaveLength(0);
  });
});
