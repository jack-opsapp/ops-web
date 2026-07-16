import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const syncEngineSource = readFileSync(
  join(process.cwd(), "src/lib/api/services/sync-engine.ts"),
  "utf8"
);
const acceptanceSource = readFileSync(
  join(
    process.cwd(),
    "src/lib/api/services/conversation-state/acceptance-evaluation.ts"
  ),
  "utf8"
);
const schedulingSource = readFileSync(
  join(
    process.cwd(),
    "src/lib/api/services/client-scheduling-comms-service.ts"
  ),
  "utf8"
);
const projectSuggestionSource = readFileSync(
  join(process.cwd(), "src/lib/api/services/project-suggestion-service.ts"),
  "utf8"
);

describe("sync-engine assigned actor boundary", () => {
  it("never attributes system conversion or shared-mailbox lead work to the connector user", () => {
    expect(syncEngineSource).not.toContain("decidedBy: connection.userId");
    expect(acceptanceSource).not.toContain("decidedBy: connection.userId");
    expect(syncEngineSource).not.toContain("user_id: connection.userId");
    expect(syncEngineSource).not.toContain("userId: connection.userId!");
    expect(syncEngineSource).toContain("createEmailOpportunityNotification({");
    expect(syncEngineSource).toContain("userId: actor.context.actorUserId");
    expect(syncEngineSource).toContain(
      'connection.type === "individual" ? connection.userId : null'
    );
  });

  it("snapshots and rechecks assignment before creating a project proposal", () => {
    expect(syncEngineSource).toContain(
      "expectedAssignmentVersion: actor.context.assignmentVersion"
    );
    expect(projectSuggestionSource).toContain(
      "opportunity.assigned_to !== userId"
    );
    expect(projectSuggestionSource).toContain(
      "opportunity.assignment_version !== expectedAssignmentVersion"
    );
    expect(projectSuggestionSource).toContain(
      "source_assignment_version: expectedAssignmentVersion"
    );
  });

  it("binds likely-won conversion to exact immutable inbound customer evidence", () => {
    expect(syncEngineSource).toContain('sourcePath: "email_likely_won"');
    expect(syncEngineSource).toContain("decidedBy: null");
    expect(syncEngineSource).toContain("expectedAssignmentVersion:");
    expect(syncEngineSource).toContain('.eq("direction", "inbound")');
    expect(syncEngineSource).toContain('.eq("party_role", "customer")');
    expect(syncEngineSource).toContain('.eq("is_meaningful", true)');
    expect(syncEngineSource).toContain(
      '.in("provider_message_id", [...candidateProviderMessageIds])'
    );
  });

  it("keeps deterministic email acceptance actorless and snapshot-bound", () => {
    expect(acceptanceSource).toContain('sourcePath: "email_accept"');
    expect(acceptanceSource).toContain("decidedBy: null");
    expect(acceptanceSource).toContain(
      "expectedAssignmentVersion: assignmentVersion"
    );
    expect(acceptanceSource).toContain("email_thread_id: internalThreadId");
    expect(acceptanceSource).toContain(
      "provider_thread_id: durableProviderThreadId"
    );
    expect(acceptanceSource).toContain('decision: "auto_advance_won"');
  });

  it("keeps reschedule drafting on the exact inbound mailbox connection", () => {
    const rescheduleSection = schedulingSource.slice(
      schedulingSource.indexOf("async detectRescheduleRequest"),
      schedulingSource.indexOf("async coordinateWithSubcontractor")
    );
    expect(rescheduleSection).toContain(
      '.eq("email_connection_id", input.connectionId)'
    );
    expect(rescheduleSection).toContain(
      '.eq("email_thread_id", input.providerThreadId)'
    );
    expect(rescheduleSection).toContain(
      "const connectionId = input.connectionId"
    );
    expect(rescheduleSection).toContain(
      "source_assignment_version: actor.context.assignmentVersion"
    );
    expect(rescheduleSection).not.toContain(
      "getActiveConnectionId(companyId, userId)"
    );
  });

  it("routes lead notifications through the locked assignment operation", () => {
    expect(syncEngineSource).toContain("createEmailOpportunityNotification({");
    expect(acceptanceSource).toContain("createEmailOpportunityNotification({");
    expect(syncEngineSource).not.toContain(
      '.from("notifications")\n    .insert({'
    );
    expect(acceptanceSource).not.toContain("create_notification_if_new");
  });

  it("only emits generic sync-complete notifications for personal mailbox owners", () => {
    const syncNotificationSection = syncEngineSource.slice(
      syncEngineSource.indexOf("async function createSyncNotification"),
      syncEngineSource.indexOf(
        "async function maybeSuggestProjectForAssignedActor"
      )
    );
    expect(syncNotificationSection).toContain(
      "createEmailSyncCompleteNotification({"
    );
    expect(syncNotificationSection).toContain(
      'connection.type === "individual" ? connection.userId : null'
    );
    expect(syncNotificationSection).not.toContain('.from("notifications")');
    expect(syncNotificationSection).not.toContain('.from("activities")');
    expect(syncNotificationSection).not.toContain("latest.from_email");
    expect(syncNotificationSection).not.toContain("latest.subject");
    expect(syncNotificationSection).not.toContain(
      "AdminFeatureOverrideService.isFeatureEnabled"
    );
  });
});
