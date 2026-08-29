import type { LegacyCapabilityDefinition } from "../capability-types";
import { CURRENT_PRODUCTION_READ_CAPABILITIES } from "./current-production";
import { V7_SITE_VISIT_READ_CAPABILITY_DEFINITIONS } from "./v7-site-visits";

export const V7_READ_CAPABILITY_DEFINITIONS = [
  ...CURRENT_PRODUCTION_READ_CAPABILITIES,
  ...V7_SITE_VISIT_READ_CAPABILITY_DEFINITIONS,
] as const satisfies readonly LegacyCapabilityDefinition[];

/** @deprecated Compatibility alias for the frozen manifest-v7 definition set. */
export const READ_CAPABILITY_DEFINITIONS = V7_READ_CAPABILITY_DEFINITIONS;

export { CURRENT_PRODUCTION_READ_CAPABILITIES } from "./current-production";
export { V7_SITE_VISIT_READ_CAPABILITY_DEFINITIONS } from "./v7-site-visits";
