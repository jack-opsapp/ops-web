import type { LegacyCapabilityDefinition } from "../capability-types";
import {
  COMMUNICATION_CONTEXT_CAPABILITY_DEFINITIONS,
  PARTICIPANT_READ_CAPABILITY_DEFINITIONS,
} from "./communication";
import { DISCOVERY_READ_CAPABILITY_DEFINITIONS } from "./discovery";
import { JOB_CATALOG_READ_CAPABILITY_DEFINITIONS } from "./job-catalog";
import { SCHEDULE_READ_CAPABILITY_DEFINITIONS } from "./schedule";

/**
 * The immutable production-v7 read surface, in exact external registration
 * order. Exposure is versioned independently in the MCP exposure catalogue.
 */
export const CURRENT_PRODUCTION_READ_CAPABILITIES = [
  ...SCHEDULE_READ_CAPABILITY_DEFINITIONS,
  ...COMMUNICATION_CONTEXT_CAPABILITY_DEFINITIONS,
  ...JOB_CATALOG_READ_CAPABILITY_DEFINITIONS,
  ...DISCOVERY_READ_CAPABILITY_DEFINITIONS,
  ...PARTICIPANT_READ_CAPABILITY_DEFINITIONS,
] as const satisfies readonly LegacyCapabilityDefinition[];

export type CurrentProductionMcpToolId =
  (typeof CURRENT_PRODUCTION_READ_CAPABILITIES)[number]["name"];
