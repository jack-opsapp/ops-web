import {
  createSupabaseActorAuthorityRepository,
  type ActorAuthorityRepository,
  type ActorAuthoritySnapshot,
  type AgentAuthoritySupabaseRpcClient,
  type AgentAuthoritySupabaseRpcResult,
  type InternalAuthorityLookup,
  type McpAuthorityLookup,
} from "@/lib/agent-control-plane/actor/authority-repository";
import {
  createSupabaseCurrentEntityAuthorizationRepository,
  type CurrentEntityAuthorizationLookup,
  type CurrentEntityAuthorizationRepository,
  type EntityAuthorizationSupabaseRpcClient,
  type EntityAuthorizationSupabaseRpcResult,
} from "@/lib/agent-control-plane/actor/authorize-entity-query";

function authorityRpcRow(snapshot: ActorAuthoritySnapshot) {
  return {
    actor_user_id: snapshot.actorUserId,
    company_id: snapshot.companyId,
    is_active: snapshot.isActive,
    is_admin: snapshot.isAdmin,
    role_ids: snapshot.roleIds,
    configured_permissions: snapshot.configuredPermissions,
    effective_permissions: snapshot.effectivePermissions,
    permission_snapshot_revision: snapshot.permissionSnapshotRevision,
  };
}

export class StubAuthoritySupabaseRpcClient implements AgentAuthoritySupabaseRpcClient {
  internalResult: ActorAuthoritySnapshot | null;
  mcpResult: ActorAuthoritySnapshot | null;
  failure: unknown | null = null;
  readonly internalLookups: InternalAuthorityLookup[] = [];
  readonly mcpLookups: McpAuthorityLookup[] = [];
  readonly repository: ActorAuthorityRepository;

  constructor(snapshot: ActorAuthoritySnapshot) {
    this.internalResult = snapshot;
    this.mcpResult = snapshot;
    this.repository = createSupabaseActorAuthorityRepository(this);
  }

  async rpc(
    functionName:
      | "resolve_agent_actor_authority_as_system"
      | "resolve_agent_actor_authority_for_subject_as_system",
    args: Readonly<Record<string, unknown>>
  ): Promise<AgentAuthoritySupabaseRpcResult> {
    if (
      functionName === "resolve_agent_actor_authority_for_subject_as_system"
    ) {
      this.internalLookups.push({
        firebaseSubject: args.p_firebase_subject as string,
        registeredPermissionKeys:
          args.p_registered_permission_keys as InternalAuthorityLookup["registeredPermissionKeys"],
      });
      return {
        data: this.internalResult ? [authorityRpcRow(this.internalResult)] : [],
        error: this.failure,
      };
    }

    this.mcpLookups.push({
      actorUserId: args.p_actor_user_id as string,
      companyId: args.p_company_id as string,
      registeredPermissionKeys:
        args.p_registered_permission_keys as McpAuthorityLookup["registeredPermissionKeys"],
    });
    return {
      data: this.mcpResult ? [authorityRpcRow(this.mcpResult)] : [],
      error: this.failure,
    };
  }
}

export function trustedAuthorityRepositoryForSnapshot(
  snapshot: ActorAuthoritySnapshot
): ActorAuthorityRepository {
  return new StubAuthoritySupabaseRpcClient(snapshot).repository;
}

export class StubEntityAuthorizationSupabaseRpcClient implements EntityAuthorizationSupabaseRpcClient {
  readonly lookups: CurrentEntityAuthorizationLookup[] = [];
  decisions: unknown[] = [true];
  failure: unknown | null = null;
  readonly repository: CurrentEntityAuthorizationRepository;

  constructor() {
    this.repository = createSupabaseCurrentEntityAuthorizationRepository(this);
  }

  async rpc(
    _functionName: "authorize_agent_entity_as_system",
    args: Readonly<Record<string, unknown>>
  ): Promise<EntityAuthorizationSupabaseRpcResult> {
    this.lookups.push({
      actorUserId: args.p_actor_user_id as string,
      companyId: args.p_company_id as string,
      entityKind:
        args.p_entity_kind as CurrentEntityAuthorizationLookup["entityKind"],
      entityId: args.p_entity_id as string,
      action: args.p_action as CurrentEntityAuthorizationLookup["action"],
    });
    return {
      data: this.decisions.shift() ?? false,
      error: this.failure,
    };
  }
}
