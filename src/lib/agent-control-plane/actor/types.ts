export type AuthChannel = "internal" | "ops_api" | "mcp";

export interface AuditClientIdentity {
  readonly applicationId: string | null;
  readonly protocolEra: string | null;
}

export interface ActorMembership {
  readonly userActive: true;
  readonly companyActive: true;
}

export interface InternalActorAuthentication {
  readonly channel: "internal" | "ops_api";
  readonly scopeCeiling: null;
}

export interface McpActorAuthentication {
  readonly channel: "mcp";
  readonly scopeCeiling: readonly string[];
  readonly oauthGrantId: string;
  readonly oauthClientId: string;
  readonly tokenId: string;
  readonly issuer: string;
  readonly audience: string;
  readonly grantRevision: string;
}

export type ActorAuthentication =
  | InternalActorAuthentication
  | McpActorAuthentication;
