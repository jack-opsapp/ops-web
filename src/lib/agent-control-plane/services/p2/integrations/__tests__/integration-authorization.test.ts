import { describe, expect, it } from "vitest";

import { authorizeCapability } from "@/lib/agent-control-plane/actor/authorize-capability";
import { GET_INTEGRATION_HEALTH_CANDIDATE } from "@/lib/agent-control-plane/registry/read-capabilities/p2/integrations";
import {
  authorizeIntegrationHealthRead,
  IntegrationHealthAuthorizationError,
  isAuthorizedIntegrationHealthRead,
} from "../integration-authorization";
import {
  INTEGRATION_CLIENT_ID,
  INTEGRATION_GRANT_ID,
  INTEGRATION_GRANT_REVISION,
  integrationActorContext,
  integrationAuthorization,
  integrationQuery,
} from "./integration-fixtures";

function policy(key: "accounting" | "mailbox") {
  const variant = GET_INTEGRATION_HEALTH_CANDIDATE.authorization.variants.find(
    (candidate) => candidate.key === key
  );
  if (!variant) throw new TypeError("integration policy missing");
  return variant.policy;
}

describe("P2 integration-health authorization", () => {
  it("mints exact frozen independent branch authority from one actor binding", async () => {
    const authorization = await integrationAuthorization();
    expect(isAuthorizedIntegrationHealthRead(authorization)).toBe(true);
    expect(authorization).toMatchObject({
      capabilityId: "get_integration_health",
      capabilityRevision: "get_integration_health:2026-08-22.v1",
      capabilityManifestRevision: "2026-08-22.capability-manifest.v8",
      oauthGrantId: INTEGRATION_GRANT_ID,
      oauthClientId: INTEGRATION_CLIENT_ID,
      grantRevision: INTEGRATION_GRANT_REVISION,
      grantedScopeCeiling: ["ops.integrations.read"],
      requiredOAuthScopes: ["ops.integrations.read"],
      query: integrationQuery(),
      variantKeys: ["accounting", "mailbox"],
      settingsIntegrationsScope: "all",
      accountingScope: "all",
      emailScope: "own",
    });
    expect(authorization.authorizationCandidates).toMatchObject([
      {
        variantKey: "accounting",
        accountingScope: "all",
        emailScope: null,
      },
      {
        variantKey: "mailbox",
        accountingScope: null,
        emailScope: "own",
      },
    ]);
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(Object.isFrozen(authorization.query.integrations)).toBe(true);
  });

  it("accepts mailbox all or own without widening an accounting-only read", async () => {
    for (const emailScope of ["own", "all"] as const) {
      const mailbox = await integrationAuthorization({
        query: {
          integrations: [{ integration_type: "mailbox", provider: "gmail" }],
        },
        emailScope,
      });
      expect(mailbox).toMatchObject({
        variantKeys: ["mailbox"],
        emailScope,
        accountingScope: null,
      });
    }
    const accounting = await integrationAuthorization({
      query: {
        integrations: [
          { integration_type: "accounting", provider: "quickbooks" },
        ],
      },
    });
    expect(accounting).toMatchObject({
      variantKeys: ["accounting"],
      accountingScope: "all",
      emailScope: null,
    });
  });

  it("fails closed on missing, extra, cloned, switched, or cross-actor proofs", async () => {
    const context = await integrationActorContext();
    const accounting = authorizeCapability({
      actorContext: context,
      policy: policy("accounting"),
    });
    const mailbox = authorizeCapability({
      actorContext: context,
      policy: policy("mailbox"),
    });
    for (const authorizations of [
      {},
      { accounting },
      { mailbox },
      { accounting, mailbox, extra: mailbox },
      { accounting: { ...accounting }, mailbox },
      { accounting: mailbox, mailbox: accounting },
    ]) {
      expect(() =>
        authorizeIntegrationHealthRead({
          query: integrationQuery(),
          authorizations,
        })
      ).toThrow(IntegrationHealthAuthorizationError);
    }

    const otherContext = await integrationActorContext("all");
    const otherMailbox = authorizeCapability({
      actorContext: otherContext,
      policy: policy("mailbox"),
    });
    expect(() =>
      authorizeIntegrationHealthRead({
        query: integrationQuery(),
        authorizations: { accounting, mailbox: otherMailbox },
      })
    ).toThrow(IntegrationHealthAuthorizationError);
  });
});
