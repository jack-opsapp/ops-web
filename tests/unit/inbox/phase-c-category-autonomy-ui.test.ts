import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const component = readFileSync(
  resolve(process.cwd(), "src/components/settings/email-category-autonomy.tsx"),
  "utf8"
);
const readinessRoute = readFileSync(
  resolve(
    process.cwd(),
    "src/app/api/integrations/email/draft-stats-by-category/route.ts"
  ),
  "utf8"
);
const settingsRoute = readFileSync(
  resolve(
    process.cwd(),
    "src/app/api/integrations/email/auto-send/settings/route.ts"
  ),
  "utf8"
);
const wizard = readFileSync(
  resolve(
    process.cwd(),
    "src/components/agent/comms-config-wizard/comms-config-wizard.tsx"
  ),
  "utf8"
);
const transportPanel = readFileSync(
  resolve(process.cwd(), "src/components/settings/auto-send-settings.tsx"),
  "utf8"
);
const statusPanel = readFileSync(
  resolve(process.cwd(), "src/components/settings/autonomy-status-panel.tsx"),
  "utf8"
);
const acceptancePage = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/agent/auto-send/page.tsx"),
  "utf8"
);
const phaseCStatusRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/agent/phase-c-status/route.ts"),
  "utf8"
);
const autonomyRouter = readFileSync(
  resolve(process.cwd(), "src/lib/api/services/phase-c-autonomy-router.ts"),
  "utf8"
);
const calibrationService = readFileSync(
  resolve(process.cwd(), "src/lib/api/services/calibration-service.ts"),
  "utf8"
);
const draftService = readFileSync(
  resolve(process.cwd(), "src/lib/api/services/ai-draft-service.ts"),
  "utf8"
);
const autonomyEnglish = readFileSync(
  resolve(process.cwd(), "src/i18n/dictionaries/en/autonomy.json"),
  "utf8"
);
const autonomySpanish = readFileSync(
  resolve(process.cwd(), "src/i18n/dictionaries/es/autonomy.json"),
  "utf8"
);

describe("Phase C exact category autonomy UI", () => {
  it("uses canonical exact-category readiness instead of shared profile counts", () => {
    expect(component).toContain("categoryReadiness");
    expect(component).toContain("sampleSize");
    expect(component).toContain("approvalRate");
    expect(component).toContain("status.ready");
    expect(component).not.toContain("PRIMARY_PROFILE_MAP");
    expect(component).not.toContain("categoryCounts");
    expect(component).not.toContain("MIN_EMAILS_FOR_AUTO");

    expect(readinessRoute).toContain("EMAIL_THREAD_CATEGORIES");
    expect(readinessRoute).toContain("PhaseCCategoryAutonomy.isGraduated(");
    expect(readinessRoute).toContain("categoryReadiness");
  });

  it("removes legacy relationship-level send controls", () => {
    expect(component).not.toContain("client_new_inquiry");
    expect(component).not.toContain("vendor_ordering");
    expect(component).not.toContain("subtrade_coordination");
  });

  it("uses the real admin feature gate in wizard step 9", () => {
    expect(wizard).not.toContain("autoSendFeatureEnabled={true}");
    expect(wizard).toContain("setAutoSendFeatureEnabled(");
    expect(wizard).toContain("settingsData.featureEnabled");
    expect(wizard).toContain("await authedFetch(");
  });

  it("sends only the exact primary-category patch for atomic acceptance", () => {
    expect(component).toContain("[`primary:${category}`]: level");
    expect(component).not.toContain("const mergedMap");
    expect(component).toContain("autoSendFeatureEnabled && status.ready");
    expect(component).toContain("authedFetch(");
    expect(component).not.toContain("Ready to enable");
    expect(component).not.toContain("% unchanged ·");
    expect(autonomyEnglish).toContain('"category.readyToEnable"');
    expect(autonomyEnglish).toContain('"category.level.auto_follow_up"');
    expect(autonomySpanish).toContain('"category.readyToEnable"');
    expect(autonomySpanish).toContain('"category.level.auto_follow_up"');
  });

  it("never offers mailbox-wide readiness or activation", () => {
    expect(transportPanel).not.toContain("stats.suggestAutoSend");
    expect(draftService).not.toContain("suggestAutoSend");
    expect(transportPanel).not.toContain("handleToggle");
    expect(transportPanel).toContain("handleDisable");
    expect(transportPanel).toContain("handleSave({ enabled: false })");
    expect(statusPanel).not.toContain("approvalRate >= 0.95");
    expect(statusPanel).not.toContain("totalDrafts >= 20");
    expect(phaseCStatusRoute).not.toContain(
      "humanAccuracy.approvalRate >= 0.95"
    );
    expect(autonomyRouter).not.toContain("GLOBAL_AUTO_SEND_LEVEL");
    expect(autonomyRouter).not.toContain(
      "AutonomyMilestoneService.getAutonomyLevel"
    );
    expect(calibrationService).toContain("PhaseCCategoryAutonomy.isGraduated(");
    expect(calibrationService).toContain("deriveCalibrationAutoSendLadder(");
    expect(calibrationService).not.toContain(
      "status: milestones.auto_send_suggested"
    );
  });

  it("loads training progress from the exact OPS actor's writing profile", () => {
    expect(settingsRoute).toContain('.from("agent_writing_profiles")');
    expect(settingsRoute).toContain('.eq("user_id", access.actor.userId)');
    expect(settingsRoute).toContain("emails_analyzed: emailsAnalyzed");
    expect(settingsRoute).toContain("WritingProfileService.getConfidence(");
  });

  it("gives assigned senders a narrow exact-category acceptance surface", () => {
    expect(acceptancePage).toContain("parsePhaseCGraduationActionScope(");
    expect(acceptancePage).toContain(
      "visiblePrimaryCategories={[scope.category]}"
    );
    expect(acceptancePage).toContain("settingsData.featureEnabled === true");
    expect(acceptancePage).not.toContain("useCalibrationDeck");
    expect(acceptancePage).not.toContain("EmailConnectionBrowserService");
  });
});
