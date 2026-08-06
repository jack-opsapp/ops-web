import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOperatorClientProvenanceUpdates } from "@/lib/clients/operator-provenance";

const routeSource = readFileSync(
  path.join(process.cwd(), "src/app/api/clients/[id]/provenance/route.ts"),
  "utf8"
);
const clientServiceSource = readFileSync(
  path.join(process.cwd(), "src/lib/api/services/client-service.ts"),
  "utf8"
);

describe("buildOperatorClientProvenanceUpdates", () => {
  it("keeps the four provenance-tracked customer fields", () => {
    expect(
      buildOperatorClientProvenanceUpdates({
        name: "Cecilia Reyes",
        email: "creyes@gmail.com",
        phone_number: "2505550100",
        address: "1200 Wharf St",
      })
    ).toEqual({
      name: "Cecilia Reyes",
      email: "creyes@gmail.com",
      phone_number: "2505550100",
      address: "1200 Wharf St",
    });
  });

  it("ignores columns that are not customer facts", () => {
    expect(
      buildOperatorClientProvenanceUpdates({
        name: "Cecilia Reyes",
        notes: "gate code 4412",
        latitude: 48.42,
        company_id: "company-1",
        profile_image_url: "https://example.com/a.png",
      })
    ).toEqual({ name: "Cecilia Reyes" });
  });

  it("drops blank and missing values", () => {
    expect(
      buildOperatorClientProvenanceUpdates({
        name: "  ",
        email: null,
        address: undefined,
      })
    ).toEqual({});
  });

  it("returns an empty set for an empty edit", () => {
    expect(buildOperatorClientProvenanceUpdates({})).toEqual({});
  });
});

describe("client provenance route", () => {
  it("authenticates the caller and gates on the granular client permission", () => {
    expect(routeSource).toContain("verifyAdminAuth(request)");
    expect(routeSource).toContain('checkPermissionById(');
    expect(routeSource).toContain('"clients.edit"');
    expect(routeSource).not.toMatch(/\.eq\("role"|user\.role ===/);
  });

  it("scopes the write to the caller's own company", () => {
    expect(routeSource).toMatch(/\.eq\("company_id",\s*companyId\)/);
  });

  it("records the edit as operator-sourced ground truth", () => {
    expect(routeSource).toContain("writeFieldProvenance({");
    expect(routeSource).toMatch(/actorUserId:\s*userId/);
  });
});

describe("client service operator provenance wiring", () => {
  it("stamps provenance after every successful client update", () => {
    expect(clientServiceSource).toContain("recordOperatorClientProvenance");
    const updateBody = clientServiceSource.slice(
      clientServiceSource.indexOf("async updateClient("),
      clientServiceSource.indexOf("async softDeleteClient(")
    );
    expect(updateBody).toContain("recordOperatorClientProvenance(");
  });
});
