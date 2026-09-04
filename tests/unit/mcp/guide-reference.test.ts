import { describe, expect, expectTypeOf, it } from "vitest";

import {
  assertPublicMcpReferenceLocalizationCoverage,
  assertPublicMcpToolGroupCoverage,
  resolvePublicMcpReference,
  type PublicMcpReferenceLocalization,
  type PublicMcpToolGroup,
  type PublicMcpToolGroupLabel,
} from "@/lib/agent-control-plane/mcp/docs/reference";

const INTERNAL_ONLY_FIELDS = [
  "rolloutFlag",
  "riskTier",
  "rateLimitBucket",
  "permissionRequirementGroups",
  "evidencePolicy",
  "auditClass",
  "confirmationPolicy",
] as const;

describe("public MCP guide reference", () => {
  it("keeps the public group label vocabulary closed at compile time", () => {
    type ExpectedPublicMcpToolGroupLabel =
      | "customersJobs"
      | "jobContext"
      | "scheduleTasks"
      | "siteVisitsEvidence"
      | "financialCatalog"
      | "companyHealth";

    expectTypeOf<
      PublicMcpToolGroup["label"]
    >().toEqualTypeOf<ExpectedPublicMcpToolGroupLabel>();
    expectTypeOf<PublicMcpToolGroupLabel>().toEqualTypeOf<ExpectedPublicMcpToolGroupLabel>();
  });

  it("resolves the exact active read-only exposure without leaking internal policy", () => {
    const reference = resolvePublicMcpReference();

    expect(reference.endpoint.endsWith("/api/mcp")).toBe(true);
    expect(reference.transport).toBe("Streamable HTTP");
    expect(reference.activeExposureRevision).toBe("2026-08-29.mcp-exposure.v2");
    expect(reference.tools).toHaveLength(34);
    expect(reference.scopes).toHaveLength(20);

    expect(
      reference.tools.every(
        (tool) => tool.operation === "read" && tool.availability === "available"
      )
    ).toBe(true);
    expect(
      reference.scopes.every(
        (scope) =>
          scope.operation === "read" && scope.consentLabel.trim().length > 0
      )
    ).toBe(true);

    const toolIds = reference.tools.map((tool) => tool.id);
    expect(toolIds).toEqual(
      expect.arrayContaining([
        "list_site_visits",
        "get_site_visit_context",
        "get_deck_design_geometry",
      ])
    );

    const serialized = JSON.stringify(reference);
    for (const field of INTERNAL_ONLY_FIELDS) {
      expect(serialized).not.toContain(field);
    }
  });

  it("groups every active tool exactly once", () => {
    const reference = resolvePublicMcpReference();
    const toolIds = reference.tools.map((tool) => tool.id);
    const groupedToolIds = reference.groups.flatMap((group) => group.toolIds);

    expect(() =>
      assertPublicMcpToolGroupCoverage(toolIds, reference.groups)
    ).not.toThrow();
    expect(groupedToolIds).toHaveLength(toolIds.length);
    expect(new Set(groupedToolIds).size).toBe(toolIds.length);
    expect([...groupedToolIds].sort()).toEqual([...toolIds].sort());
  });

  it("rejects duplicate tool membership across public groups", () => {
    const toolIds = ["first_tool", "second_tool"] as const;
    const groups = [
      {
        id: "first",
        label: "customersJobs",
        toolIds: ["first_tool"],
      },
      {
        id: "second",
        label: "jobContext",
        toolIds: ["first_tool", "second_tool"],
      },
    ] as const satisfies readonly PublicMcpToolGroup[];

    expect(() => assertPublicMcpToolGroupCoverage(toolIds, groups)).toThrow();
  });

  it("rejects active tools omitted from every public group", () => {
    const toolIds = ["first_tool", "second_tool"] as const;
    const groups = [
      {
        id: "first",
        label: "customersJobs",
        toolIds: ["first_tool"],
      },
    ] as const satisfies readonly PublicMcpToolGroup[];

    expect(() => assertPublicMcpToolGroupCoverage(toolIds, groups)).toThrow();
  });

  it("localizes every source-derived tool and scope label without changing canonical ids", () => {
    const english = resolvePublicMcpReference();
    const spanish = resolvePublicMcpReference("es");

    expect(spanish.tools.map((tool) => tool.id)).toEqual(
      english.tools.map((tool) => tool.id)
    );
    expect(spanish.scopes.map((scope) => scope.id)).toEqual(
      english.scopes.map((scope) => scope.id)
    );
    expect(
      spanish.tools.every(
        (tool, index) => tool.description !== english.tools[index]?.description
      )
    ).toBe(true);
    expect(
      spanish.scopes.every(
        (scope, index) =>
          scope.consentLabel !== english.scopes[index]?.consentLabel
      )
    ).toBe(true);
    expect(
      spanish.tools.find((tool) => tool.id === "search_customers")?.description
    ).toBe(
      "Busca clientes a los que puedes acceder por nombre, correo electrónico exacto o teléfono exacto. Nunca devuelve los datos de contacto."
    );
    expect(
      spanish.scopes.find((scope) => scope.id === "ops.jobs.read")?.consentLabel
    ).toBe("Ver tus trabajos y su estado");
  });

  it("fails closed when an active tool lacks localized public copy", () => {
    expect(() =>
      assertPublicMcpReferenceLocalizationCoverage(
        resolvePublicMcpReference(),
        {
          toolDescriptions: {},
          scopeConsentLabels: {},
        } satisfies PublicMcpReferenceLocalization
      )
    ).toThrow(/tool description localization.*list_scheduled_jobs/i);
  });

  it("fails closed when an active scope lacks localized consent copy", () => {
    const reference = resolvePublicMcpReference();
    const completeToolDescriptions = Object.fromEntries(
      reference.tools.map((tool) => [tool.id, `Traducción: ${tool.id}`])
    );

    expect(() =>
      assertPublicMcpReferenceLocalizationCoverage(reference, {
        toolDescriptions: completeToolDescriptions,
        scopeConsentLabels: {},
      } satisfies PublicMcpReferenceLocalization)
    ).toThrow(/scope consent localization.*ops.jobs.read/i);
  });
});
