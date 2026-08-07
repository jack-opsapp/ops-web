import {
  createInternalPrincipalFromVerifiedFirebase,
  createMcpPrincipalFromValidatedGrant,
} from "@/lib/agent-control-plane/actor/principal-boundary";

export const verifiedInternalPrincipalFixture =
  createInternalPrincipalFromVerifiedFirebase;

export const validatedMcpPrincipalFixture =
  createMcpPrincipalFromValidatedGrant;
