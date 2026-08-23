import "server-only";

export interface P2PrivateProjectionContract {
  readonly name: string;
  readonly signature: string;
  readonly projectionRevision: string;
  readonly maximumCards: 25;
  readonly fetchLimit: 26;
  readonly sourceInspectionLimit: 501;
  readonly revisionFamilies: readonly string[];
  readonly permissionKeys: readonly string[];
  readonly executableRoles: readonly ["postgres"];
  readonly caller: "service_role_outer_rpc_only";
}

function projection(
  value: Omit<
    P2PrivateProjectionContract,
    | "maximumCards"
    | "fetchLimit"
    | "sourceInspectionLimit"
    | "executableRoles"
    | "caller"
  >
): P2PrivateProjectionContract {
  return Object.freeze({
    ...value,
    revisionFamilies: Object.freeze([...value.revisionFamilies]),
    permissionKeys: Object.freeze([...value.permissionKeys]),
    maximumCards: 25,
    fetchLimit: 26,
    sourceInspectionLimit: 501,
    executableRoles: Object.freeze(["postgres"] as const),
    caller: "service_role_outer_rpc_only",
  });
}

export const P2_LEGACY_ATTENTION_PROJECTIONS = Object.freeze({
  lead: projection({
    name: "private.agent_p2_legacy_lead_attention_v1",
    signature:
      "private.agent_p2_legacy_lead_attention_v1(uuid,uuid,text,text[],text,timestamp with time zone,integer)",
    projectionRevision: "agent-p2-legacy-lead-attention:v1",
    revisionFamilies: ["legacy_operational"],
    permissionKeys: ["pipeline.view"],
  }),
  correspondence: projection({
    name: "private.agent_p2_legacy_correspondence_attention_v1",
    signature:
      "private.agent_p2_legacy_correspondence_attention_v1(uuid,uuid,text,text[],text,text,text,timestamp with time zone,integer)",
    projectionRevision: "agent-p2-legacy-correspondence-attention:v1",
    revisionFamilies: ["legacy_job_history", "legacy_operational"],
    permissionKeys: ["email.view", "inbox.view", "pipeline.view"],
  }),
  schedule: projection({
    name: "private.agent_p2_legacy_schedule_attention_v1",
    signature:
      "private.agent_p2_legacy_schedule_attention_v1(uuid,uuid,text,text[],text,text,text,timestamp with time zone,integer)",
    projectionRevision: "agent-p2-legacy-schedule-attention:v1",
    revisionFamilies: ["legacy_operational"],
    permissionKeys: ["calendar.view", "projects.view", "tasks.view"],
  }),
} as const);

export const P2_LEGACY_ATTENTION_PROJECTION_NAMES = Object.freeze(
  Object.values(P2_LEGACY_ATTENTION_PROJECTIONS)
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
);
