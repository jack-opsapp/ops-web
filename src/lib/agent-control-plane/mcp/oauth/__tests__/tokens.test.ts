import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_PREFIX,
  AUTHORIZATION_CODE_TTL_SECONDS,
  CONSENT_PREVIEW_PREFIX,
  CONSENT_PREVIEW_TTL_SECONDS,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
  credentialDigest,
  isConsentSnapshotValidForExposure,
  isSha256Hex,
  mintCredential,
  secretsEqual,
  sha256Hex,
  type CredentialPrefix,
} from "@/lib/agent-control-plane/mcp/oauth/tokens";
import { MCP_CONSENT_CATALOG_V1 } from "@/lib/agent-control-plane/mcp/oauth/scope-catalog";
import {
  MCP_EXPOSURE_V1,
  type McpExposure,
} from "@/lib/agent-control-plane/registry/mcp-exposure-catalog";

const BASE64URL_SECRET = /^[A-Za-z0-9_-]{43}$/;
const VALID_SECRET = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

const ALL_PREFIXES: readonly CredentialPrefix[] = [
  ACCESS_TOKEN_PREFIX,
  REFRESH_TOKEN_PREFIX,
  AUTHORIZATION_CODE_PREFIX,
  CONSENT_PREVIEW_PREFIX,
];

describe("MCP OAuth credential minting", () => {
  it("pins the greppable prefixes and lifetimes the OAuth endpoints depend on", () => {
    expect(ACCESS_TOKEN_PREFIX).toBe("ops_mcp_at_");
    expect(REFRESH_TOKEN_PREFIX).toBe("ops_mcp_rt_");
    expect(AUTHORIZATION_CODE_PREFIX).toBe("ops_mcp_ac_");
    expect(CONSENT_PREVIEW_PREFIX).toBe("ops_mcp_cp_");
    expect(new Set(ALL_PREFIXES).size).toBe(ALL_PREFIXES.length);

    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(600);
    expect(REFRESH_TOKEN_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(AUTHORIZATION_CODE_TTL_SECONDS).toBe(300);
    expect(CONSENT_PREVIEW_TTL_SECONDS).toBe(300);
  });

  it.each(ALL_PREFIXES)(
    "mints %s credentials as the prefix plus 43 base64url characters",
    (prefix) => {
      const credential = mintCredential(prefix);

      expect(credential.startsWith(prefix)).toBe(true);
      expect(credential).toHaveLength(prefix.length + 43);
      expect(credential.slice(prefix.length)).toMatch(BASE64URL_SECRET);
    }
  );

  it("mints unbiased, non-repeating secret material", () => {
    const first = mintCredential(ACCESS_TOKEN_PREFIX);
    const second = mintCredential(ACCESS_TOKEN_PREFIX);

    expect(first).not.toBe(second);
    expect(credentialDigest(first, ACCESS_TOKEN_PREFIX)).not.toBe(
      credentialDigest(second, ACCESS_TOKEN_PREFIX)
    );

    const batch = new Set(
      Array.from({ length: 64 }, () => mintCredential(REFRESH_TOKEN_PREFIX))
    );
    expect(batch.size).toBe(64);
  });
});

describe("immutable consent claims", () => {
  const claims = Object.freeze({
    scopes: Object.freeze(["ops.jobs.read", "ops.schedule.read"]),
    acceptedLabels: Object.freeze([
      "See your jobs and their status",
      "See your schedule and who's assigned",
    ]),
    consentCatalogRevision: "2026-08-22.mcp-consent-catalog.v1",
    exposureRevision: "2026-08-22.mcp-exposure.v1",
  });

  it("accepts exact code claims only under the active exposure revision", () => {
    expect(
      isConsentSnapshotValidForExposure(
        claims,
        MCP_EXPOSURE_V1,
        MCP_CONSENT_CATALOG_V1,
        { requireActiveExposureRevision: true }
      )
    ).toBe(true);
    expect(
      isConsentSnapshotValidForExposure(
        { ...claims, exposureRevision: "test.mcp-exposure.v0" },
        MCP_EXPOSURE_V1,
        MCP_CONSENT_CATALOG_V1,
        { requireActiveExposureRevision: true }
      )
    ).toBe(false);
  });

  it("keeps an old grant refreshable without adding an expanded exposure scope", () => {
    const expandedExposure: McpExposure = Object.freeze({
      revision: "test.mcp-exposure.v2",
      toolIds: Object.freeze(["synthetic_read"]),
      grantableScopes: Object.freeze([
        ...MCP_EXPOSURE_V1.grantableScopes,
        "ops.tasks.read",
      ]),
    });

    expect(
      isConsentSnapshotValidForExposure(
        claims,
        expandedExposure,
        MCP_CONSENT_CATALOG_V1,
        { requireActiveExposureRevision: false }
      )
    ).toBe(true);
    expect(claims.scopes).toEqual(["ops.jobs.read", "ops.schedule.read"]);
    expect(claims.scopes).not.toContain("ops.tasks.read");
  });

  it("fails closed for a widened scope, mismatched label, or wrong consent catalogue", () => {
    const catalog = MCP_CONSENT_CATALOG_V1;
    expect(
      isConsentSnapshotValidForExposure(
        {
          ...claims,
          scopes: [...claims.scopes, "ops.tasks.read"],
          acceptedLabels: [
            ...claims.acceptedLabels,
            "See tasks and work that needs attention",
          ],
        },
        MCP_EXPOSURE_V1,
        catalog,
        { requireActiveExposureRevision: false }
      )
    ).toBe(false);
    expect(
      isConsentSnapshotValidForExposure(
        { ...claims, acceptedLabels: ["Wrong", claims.acceptedLabels[1]!] },
        MCP_EXPOSURE_V1,
        catalog,
        { requireActiveExposureRevision: false }
      )
    ).toBe(false);
    expect(
      isConsentSnapshotValidForExposure(
        { ...claims, consentCatalogRevision: "test.wrong" },
        MCP_EXPOSURE_V1,
        catalog,
        { requireActiveExposureRevision: false }
      )
    ).toBe(false);
  });
});

describe("MCP OAuth credential digests", () => {
  it("hashes the full presented string, prefix included", () => {
    const presented = `${ACCESS_TOKEN_PREFIX}${VALID_SECRET}`;
    const expected = createHash("sha256")
      .update(presented, "utf8")
      .digest("hex");

    expect(credentialDigest(presented, ACCESS_TOKEN_PREFIX)).toBe(expected);
    expect(sha256Hex(presented)).toBe(expected);
    expect(isSha256Hex(expected)).toBe(true);
  });

  it("derives a distinct digest for every credential kind and for the bare secret", () => {
    const digests = ALL_PREFIXES.map((prefix) =>
      credentialDigest(`${prefix}${VALID_SECRET}`, prefix)
    );

    expect(new Set(digests).size).toBe(ALL_PREFIXES.length);
    expect(digests).not.toContain(sha256Hex(VALID_SECRET));
  });

  it("refuses a credential minted for a different endpoint", () => {
    const accessToken = mintCredential(ACCESS_TOKEN_PREFIX);

    expect(credentialDigest(accessToken, ACCESS_TOKEN_PREFIX)).toMatch(
      /^[0-9a-f]{64}$/
    );
    expect(credentialDigest(accessToken, REFRESH_TOKEN_PREFIX)).toBeNull();
    expect(credentialDigest(accessToken, AUTHORIZATION_CODE_PREFIX)).toBeNull();
  });

  it.each([
    { label: "an empty string", presented: "" },
    { label: "the prefix alone", presented: ACCESS_TOKEN_PREFIX },
    {
      label: "a foreign prefix",
      presented: `ops_mcp_xx_${VALID_SECRET}`,
    },
    {
      label: "no prefix at all",
      presented: VALID_SECRET,
    },
    {
      label: "an uppercased prefix",
      presented: `OPS_MCP_AT_${VALID_SECRET}`,
    },
    {
      label: "a prefix that only appears later in the string",
      presented: `x${ACCESS_TOKEN_PREFIX}${VALID_SECRET}`,
    },
    {
      label: "a truncated secret",
      presented: `${ACCESS_TOKEN_PREFIX}${VALID_SECRET.slice(0, 42)}`,
    },
    {
      label: "an extended secret",
      presented: `${ACCESS_TOKEN_PREFIX}${VALID_SECRET}A`,
    },
    {
      label: "standard-base64 padding characters",
      presented: `${ACCESS_TOKEN_PREFIX}${VALID_SECRET.slice(0, 41)}==`,
    },
    {
      label: "standard-base64 alphabet characters",
      presented: `${ACCESS_TOKEN_PREFIX}${VALID_SECRET.slice(0, 41)}+/`,
    },
    {
      label: "trailing whitespace",
      presented: `${ACCESS_TOKEN_PREFIX}${VALID_SECRET} `,
    },
    {
      label: "an embedded header-injection newline",
      presented: `${ACCESS_TOKEN_PREFIX}${VALID_SECRET.slice(0, 41)}\r\n`,
    },
  ])("returns null for $label", ({ presented }) => {
    expect(credentialDigest(presented, ACCESS_TOKEN_PREFIX)).toBeNull();
  });

  it("returns null for a non-string presentation instead of throwing", () => {
    for (const hostile of [null, undefined, 42, {}, [], true]) {
      expect(
        credentialDigest(hostile as unknown as string, ACCESS_TOKEN_PREFIX)
      ).toBeNull();
    }
  });
});

describe("sha256 hex recognition", () => {
  it("accepts exactly 64 lowercase hex characters", () => {
    expect(isSha256Hex("0".repeat(64))).toBe(true);
    expect(isSha256Hex("abcdef0123456789".repeat(4))).toBe(true);
    expect(isSha256Hex(sha256Hex("anything"))).toBe(true);
  });

  it.each([
    { label: "an empty string", value: "" },
    { label: "63 characters", value: "a".repeat(63) },
    { label: "65 characters", value: "a".repeat(65) },
    { label: "uppercase hex", value: "A".repeat(64) },
    { label: "mixed case hex", value: `A${"a".repeat(63)}` },
    { label: "a non-hex letter", value: `g${"a".repeat(63)}` },
    { label: "a hex string with whitespace", value: ` ${"a".repeat(63)}` },
    { label: "a trailing newline", value: `${"a".repeat(64)}\n` },
    { label: "a 0x-prefixed digest", value: `0x${"a".repeat(62)}` },
  ])("rejects $label", ({ value }) => {
    expect(isSha256Hex(value)).toBe(false);
  });
});

describe("constant-time secret comparison", () => {
  it("reports equality for identical secrets", () => {
    const minted = mintCredential(ACCESS_TOKEN_PREFIX);

    expect(secretsEqual(minted, minted)).toBe(true);
    expect(secretsEqual(minted, `${minted}`)).toBe(true);
    expect(secretsEqual(sha256Hex("a"), sha256Hex("a"))).toBe(true);
  });

  it("reports inequality for same-length secrets that differ", () => {
    const left = "a".repeat(43);

    expect(secretsEqual(left, `b${left.slice(1)}`)).toBe(false);
    expect(secretsEqual(left, `${left.slice(0, 42)}b`)).toBe(false);
    expect(secretsEqual(sha256Hex("a"), sha256Hex("b"))).toBe(false);
  });

  it("reports inequality on a length mismatch without throwing", () => {
    expect(secretsEqual("a".repeat(43), "a".repeat(42))).toBe(false);
    expect(secretsEqual("a".repeat(42), "a".repeat(43))).toBe(false);
    expect(secretsEqual("", "a")).toBe(false);
    expect(secretsEqual("a", "")).toBe(false);
  });

  it("compares raw bytes, so multibyte prefixes never short-circuit", () => {
    // "é" is two UTF-8 bytes: the comparison must be byte-wise, not char-wise.
    expect(secretsEqual("é", "ab")).toBe(false);
    expect(secretsEqual("é", "é")).toBe(true);
    expect(secretsEqual("é", "e")).toBe(false);
  });

  it("is a byte comparison, not a validity check — callers must shape-check first", () => {
    expect(secretsEqual("", "")).toBe(true);
  });
});
