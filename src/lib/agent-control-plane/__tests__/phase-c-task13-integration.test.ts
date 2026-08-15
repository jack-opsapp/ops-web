import { describe, expect, it } from "vitest";

import { createInternalPhaseCAdapter } from "@/lib/agent-control-plane/adapters/internal";
import { observeReplyContextShadow } from "@/lib/agent-control-plane/memory/reply-context-shadow";
import {
  CAPABILITY_MANIFEST_REVISION,
  getCapabilityManifestEntry,
} from "@/lib/agent-control-plane/registry/capability-manifest";

const INTERNAL_READS = [
  "get_job_conversation_context",
  "list_scheduled_jobs",
  "list_job_readiness_issues",
  "get_job_communication_context",
  "resolve_job_participants",
  "list_customer_jobs",
  "get_job_summary",
  "search_job_history",
  "get_correspondence_evidence",
] as const;

describe("Phase C and Task 13 integration", () => {
  it("keeps the Phase C seams while exposing only the complete internal v6 read set", () => {
    expect(createInternalPhaseCAdapter).toBeTypeOf("function");
    expect(observeReplyContextShadow).toBeTypeOf("function");
    expect(CAPABILITY_MANIFEST_REVISION).toBe(
      "2026-08-14.capability-manifest.v6"
    );

    for (const capabilityName of INTERNAL_READS) {
      const capability = getCapabilityManifestEntry(capabilityName);
      expect(capability.operation).toBe("read");
      expect(capability.availability).toEqual({
        implementation: "available",
        externalExposure: "disabled",
      });
    }
  });
});
