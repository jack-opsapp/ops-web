import { describe, expect, it } from "vitest";

import {
  SCOPE_CONSENT_LABELS,
  SUPPORTED_READ_SCOPES,
  isSupportedReadScope,
  resolveRequestedScopes,
  scopesToParameter,
  type SupportedReadScope,
} from "@/lib/agent-control-plane/mcp/oauth/scopes";
import { READ_CAPABILITY_DEFINITIONS } from "@/lib/agent-control-plane/registry/read-tools";
import {
  CAPABILITY_OAUTH_SCOPES,
  type CapabilityDefinition,
} from "@/lib/agent-control-plane/registry/capability-types";

/**
 * The consent surface must publish exactly the union of every OAuth scope the
 * nine implemented v6 reads require — no less, or a fully consented connection
 * still gets `insufficient_scope`; no more, or consent over-grants.
 */
const CANONICAL_ORDER: readonly string[] = [
  "ops.jobs.read",
  "ops.schedule.read",
  "ops.customers.read",
  "ops.customer_contacts.read",
  "ops.photos.read",
  "ops.correspondence.read",
  "ops.financials.read",
];

/**
 * The nine v6 reads are the ones the domain service implements; the two
 * site-visit capabilities remain dark. Only the implemented set can ever be
 * dispatched through the MCP mount, so it is the set the consent grant must
 * be able to satisfy.
 */
const IMPLEMENTED_READS: readonly CapabilityDefinition[] =
  READ_CAPABILITY_DEFINITIONS.filter(
    (definition) => definition.availability.implementation === "available"
  );

describe("supported read scopes", () => {
  it("publishes exactly the manifest's read scopes in canonical order", () => {
    expect([...SUPPORTED_READ_SCOPES]).toEqual(CANONICAL_ORDER);
    expect(Object.isFrozen(SUPPORTED_READ_SCOPES)).toBe(true);
    expect(new Set(SUPPORTED_READ_SCOPES).size).toBe(
      SUPPORTED_READ_SCOPES.length
    );
  });

  it("issues no write, prepare, admin, or wildcard authority", () => {
    for (const scope of SUPPORTED_READ_SCOPES) {
      expect(scope).toMatch(/^ops\.[a-z_]+\.read$/);
    }
  });

  it("only issues scopes the reviewed capability registry defines", () => {
    const registered = new Set<string>(CAPABILITY_OAUTH_SCOPES);

    for (const scope of SUPPORTED_READ_SCOPES) {
      expect(registered.has(scope)).toBe(true);
    }
  });

  it("recognizes only the published scope strings", () => {
    for (const scope of SUPPORTED_READ_SCOPES) {
      expect(isSupportedReadScope(scope)).toBe(true);
    }
    for (const impostor of [
      "",
      "ops.jobs.write",
      "ops.jobs.read ",
      " ops.jobs.read",
      "OPS.JOBS.READ",
      "ops.everything.read",
      "openid",
      "*",
    ]) {
      expect(isSupportedReadScope(impostor)).toBe(false);
    }
  });

  it("renders a scope set back to an OAuth scope parameter", () => {
    expect(scopesToParameter(SUPPORTED_READ_SCOPES)).toBe(
      CANONICAL_ORDER.join(" ")
    );
    expect(scopesToParameter(["ops.jobs.read"])).toBe("ops.jobs.read");
    expect(scopesToParameter([])).toBe("");
  });
});

describe("consent labels", () => {
  it("covers exactly the supported read scopes", () => {
    expect(Object.keys(SCOPE_CONSENT_LABELS).sort()).toEqual(
      [...SUPPORTED_READ_SCOPES].sort()
    );
    expect(Object.isFrozen(SCOPE_CONSENT_LABELS)).toBe(true);
  });

  it("gives every scope a distinct, plain-language, read-honest line", () => {
    const labels = SUPPORTED_READ_SCOPES.map(
      (scope) => SCOPE_CONSENT_LABELS[scope]
    );

    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label.trim()).toBe(label);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/scope|oauth|api|token|endpoint/i);
      expect(label).not.toContain("!");
    }
  });
});

describe("requested scope resolution", () => {
  it.each([
    { label: "null", requested: null },
    { label: "undefined", requested: undefined },
    { label: "an empty string", requested: "" },
    { label: "a whitespace-only string", requested: "   " },
    { label: "a tab-and-newline string", requested: "\t\n " },
  ])(
    "defaults $label to the full read set in canonical order",
    ({ requested }) => {
      expect(resolveRequestedScopes(requested)).toEqual(CANONICAL_ORDER);
    }
  );

  it("preserves canonical order regardless of the order requested", () => {
    expect(resolveRequestedScopes("ops.financials.read ops.jobs.read")).toEqual(
      ["ops.jobs.read", "ops.financials.read"]
    );
    expect(
      resolveRequestedScopes(
        "ops.photos.read ops.correspondence.read ops.schedule.read"
      )
    ).toEqual([
      "ops.schedule.read",
      "ops.photos.read",
      "ops.correspondence.read",
    ]);
    expect(
      resolveRequestedScopes([...CANONICAL_ORDER].reverse().join(" "))
    ).toEqual(CANONICAL_ORDER);
  });

  it("collapses duplicates and tolerates irregular whitespace between entries", () => {
    expect(
      resolveRequestedScopes(
        "  ops.jobs.read   ops.jobs.read\tops.photos.read "
      )
    ).toEqual(["ops.jobs.read", "ops.photos.read"]);
  });

  it("returns a frozen result the caller cannot mutate", () => {
    const resolved = resolveRequestedScopes("ops.jobs.read");

    expect(resolved).not.toBeNull();
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it.each([
    { label: "an unknown scope", requested: "ops.everything.read" },
    {
      label: "an unknown scope mixed with supported ones",
      requested: "ops.jobs.read ops.payroll.read",
    },
    { label: "a write scope", requested: "ops.jobs.write" },
    { label: "an admin scope", requested: "ops.admin" },
    { label: "a wildcard", requested: "*" },
    { label: "an OIDC scope", requested: "openid profile email" },
    { label: "a case-shifted scope", requested: "OPS.JOBS.READ" },
    {
      label: "a scope carrying an injected quote",
      requested: 'ops.jobs.read"',
    },
    { label: "a bare separator character", requested: "," },
  ])("rejects $label rather than silently dropping it", ({ requested }) => {
    expect(resolveRequestedScopes(requested)).toBeNull();
  });

  it("accepts exactly 32 entries and rejects the 33rd", () => {
    const thirtyTwo = Array.from({ length: 32 }, () => "ops.jobs.read").join(
      " "
    );
    const thirtyThree = Array.from({ length: 33 }, () => "ops.jobs.read").join(
      " "
    );

    expect(resolveRequestedScopes(thirtyTwo)).toEqual(["ops.jobs.read"]);
    expect(resolveRequestedScopes(thirtyThree)).toBeNull();
  });

  it("never yields an empty grant: a request either resolves to at least one scope or to null", () => {
    const probes = [
      null,
      undefined,
      "",
      " ",
      "\u00a0",
      "\t",
      "\n",
      "ops.jobs.read",
      "ops.jobs.read ops.unknown.read",
      "unknown",
    ];

    for (const probe of probes) {
      const resolved = resolveRequestedScopes(probe);
      if (resolved !== null) {
        expect(resolved.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("capability manifest consistency", () => {
  it("implements eleven reads while discovery remains outside the external mount", () => {
    expect(IMPLEMENTED_READS.map((definition) => definition.name)).toEqual([
      "list_scheduled_jobs",
      "list_job_readiness_issues",
      "get_job_communication_context",
      "get_job_conversation_context",
      "list_customer_jobs",
      "get_job_summary",
      "search_job_history",
      "get_correspondence_evidence",
      "search_customers",
      "search_jobs",
      "resolve_job_participants",
    ]);
  });

  it("keeps every capability variant inside the grantable scope ceiling", () => {
    const offenders: string[] = [];

    for (const definition of IMPLEMENTED_READS) {
      for (const variant of definition.authorization.variants) {
        expect(variant.requiredOAuthScopes.length).toBeGreaterThan(0);
        for (const scope of variant.requiredOAuthScopes) {
          if (!isSupportedReadScope(scope)) {
            offenders.push(`${definition.name}:${variant.key} → ${scope}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("grants nothing broader than the manifest actually requires", () => {
    const required = new Set<string>();
    for (const definition of IMPLEMENTED_READS) {
      for (const variant of definition.authorization.variants) {
        for (const scope of variant.requiredOAuthScopes) required.add(scope);
      }
    }

    expect([...required].sort()).toEqual([...SUPPORTED_READ_SCOPES].sort());
  });

  it("lets the full consent grant satisfy every variant's ceiling", () => {
    const consented = new Set<SupportedReadScope>(
      resolveRequestedScopes(null) ?? []
    );

    for (const definition of IMPLEMENTED_READS) {
      for (const variant of definition.authorization.variants) {
        const unsatisfied = variant.requiredOAuthScopes.filter(
          (scope) => !consented.has(scope as SupportedReadScope)
        );
        expect(unsatisfied).toEqual([]);
      }
    }
  });
});
