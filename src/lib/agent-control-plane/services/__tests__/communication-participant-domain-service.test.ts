import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, expectTypeOf, it } from "vitest";

import type { ActorContext } from "@/lib/agent-control-plane/actor/resolve-actor-context";
import type {
  JobCommunicationContextInput,
  JobCommunicationContextResult,
  JobParticipantsInput,
  JobParticipantsResult,
} from "@/lib/agent-control-plane/contracts/communication";
import type {
  DomainCallOptions,
  OpsAgentDomainService,
} from "../domain-service";

describe("communication and participant domain facade contract", () => {
  it("declares both methods on the concrete domain boundary", () => {
    const domainSource = readFileSync(
      join(
        process.cwd(),
        "src/lib/agent-control-plane/services/domain-service.ts"
      ),
      "utf8"
    );
    const factorySource = readFileSync(
      join(
        process.cwd(),
        "src/lib/agent-control-plane/services/create-domain-service.ts"
      ),
      "utf8"
    );

    expect(domainSource).toContain("getJobCommunicationContext(");
    expect(domainSource).toContain("resolveJobParticipants(");
    expect(factorySource).toContain("getJobCommunicationContext");
    expect(factorySource).toContain("resolveJobParticipants");
  });

  it("exposes the two transport-neutral current-only reads", () => {
    type ExpectedCommunicationMethod = (
      actor: ActorContext,
      input: JobCommunicationContextInput,
      options?: DomainCallOptions
    ) => Promise<JobCommunicationContextResult>;
    type ExpectedParticipantMethod = (
      actor: ActorContext,
      input: JobParticipantsInput,
      options?: DomainCallOptions
    ) => Promise<JobParticipantsResult>;

    expectTypeOf<
      OpsAgentDomainService["getJobCommunicationContext"]
    >().toEqualTypeOf<ExpectedCommunicationMethod>();
    expectTypeOf<
      OpsAgentDomainService["resolveJobParticipants"]
    >().toEqualTypeOf<ExpectedParticipantMethod>();
  });
});
