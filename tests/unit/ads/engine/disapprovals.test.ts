import { describe, expect, it } from "vitest";
import {
  alertKeys,
  challengerInPlace,
  changeWindow,
  engineClaim,
  graceElapsed,
  isApprovedAgain,
  isTransient,
  pauseFailedAlert,
  pauseProvenance,
  pausedAlert,
  policyReason,
  replacementDue,
  restoreFailedAlert,
  restoredAlert,
  retiredAdIdsFrom,
  routineActive,
  type AdChangeEvent,
  type EngineAdDecision,
  type GuardrailPause,
} from "@/lib/ads/engine/disapprovals";
import { loadBlueprint } from "@/lib/ads/blueprint";
import { NOW, R, settings, snapshot, tests } from "./fixtures";

const AD = "customers/4454506598/adGroupAds/200351113415~824125294528";
const GROUP = "customers/4454506598/adGroups/200351113415";

function pause(overrides: Partial<GuardrailPause> = {}): GuardrailPause {
  return {
    id: "9f0c1f4e-8f1a-4c8b-9a51-2b1d5e3c7a10",
    ad_resource_name: AD,
    ad_id: "824125294528",
    ad_group_resource_name: GROUP,
    ad_group_name: "Jobber pricing",
    campaign_resource_name: "customers/4454506598/campaigns/23100000001",
    state: "paused",
    policy_topics: ["DESTINATION_NOT_WORKING"],
    observed_at: "2026-09-09T14:59:20.000Z",
    // The real pause: Google committed it at 1789052369290063 µs (2026-09-10 14:59:29.290Z).
    pause_requested_at: "2026-09-10T14:59:28.900Z",
    paused_at: "2026-09-10T14:59:29.400Z",
    pause_error: null,
    ...overrides,
  };
}

function event(overrides: Partial<AdChangeEvent> = {}): AdChangeEvent {
  return {
    micros: 1789052369290063,
    resourceName: AD,
    operation: "UPDATE",
    changedFields: ["ad", "status"],
    clientType: "GOOGLE_ADS_API",
    userEmail: "firebase-adminsdk-fbsvc@ops-ios-app.iam.gserviceaccount.com",
    oldStatus: "ENABLED",
    newStatus: "PAUSED",
    ...overrides,
  };
}

function decision(overrides: Partial<EngineAdDecision> = {}): EngineAdDecision {
  return {
    id: "pppppppp-pppp-4ppp-8ppp-000000000077",
    kind: "pause_ad",
    state: "proposed",
    payload: { ad: AD },
    created_at: "2026-09-12T15:05:00.000Z",
    applied_at: null,
    ...overrides,
  };
}

describe("which disapprovals wait a tick", () => {
  it("holds a landing-page verdict, which is often a crawl that failed once", () => {
    expect(isTransient(["DESTINATION_NOT_WORKING"])).toBe(true);
  });

  it("acts on any other verdict at once, including a landing-page verdict that carries a second topic", () => {
    expect(isTransient(["TRADEMARKS_IN_AD_TEXT"])).toBe(false);
    expect(isTransient(["DESTINATION_NOT_WORKING", "MISLEADING_AD_DESIGN"])).toBe(false);
  });

  it("treats a disapproval with no topic as durable", () => {
    expect(isTransient([])).toBe(false);
  });

  it("waits twenty hours from the first sighting, so the next daily check is the one that acts", () => {
    const observed = "2026-09-10T14:59:20.000Z";
    expect(graceElapsed(observed, new Date("2026-09-11T10:59:19.000Z"))).toBe(false);
    expect(graceElapsed(observed, new Date("2026-09-11T10:59:20.000Z"))).toBe(true);
    expect(graceElapsed(observed, new Date("2026-09-11T14:59:05.000Z"))).toBe(true);
  });
});

describe("when an ad counts as approved again", () => {
  const live = (approvalStatus: string, reviewStatus = "REVIEWED") => ({ resourceName: AD, status: "PAUSED", approvalStatus, reviewStatus, policyTopics: [] });

  it("on a finished review that lets the ad serve", () => {
    expect(isApprovedAgain(live("APPROVED"))).toBe(true);
    expect(isApprovedAgain(live("APPROVED_LIMITED"))).toBe(true);
    expect(isApprovedAgain(live("AREA_OF_INTEREST_ONLY"))).toBe(true);
  });

  it("never while the verdict stands or a review or appeal is still open", () => {
    expect(isApprovedAgain(live("DISAPPROVED"))).toBe(false);
    expect(isApprovedAgain(live("APPROVED", "REVIEW_IN_PROGRESS"))).toBe(false);
    expect(isApprovedAgain(live("DISAPPROVED", "UNDER_APPEAL"))).toBe(false);
    expect(isApprovedAgain(live("UNKNOWN"))).toBe(false);
  });
});

describe("the engine's own claim on a paused ad", () => {
  it("has none when no proposal names the ad or its group", () => {
    expect(engineClaim(pause(), [])).toBe("none");
    expect(engineClaim(pause(), [decision({ payload: { ad: "customers/4454506598/adGroupAds/1~2" } })])).toBe("none");
  });

  it("is pending while a pause, a promotion that retires the ad, or a challenger for its group waits on review", () => {
    expect(engineClaim(pause(), [decision()])).toBe("pending");
    expect(engineClaim(pause(), [decision({ kind: "promote_challenger", state: "approved", payload: { loser: AD, winner: "x" } })])).toBe("pending");
    expect(engineClaim(pause(), [decision({ kind: "create_rsa_challenger", payload: { ad_group: GROUP } })])).toBe("pending");
  });

  it("is applied when one of those landed after the guardrail first saw the verdict", () => {
    expect(engineClaim(pause(), [decision({ kind: "create_rsa_challenger", state: "applied", payload: { ad_group: GROUP }, applied_at: "2026-09-10T15:02:00.000Z" })])).toBe("applied");
    expect(engineClaim(pause(), [decision({ state: "pending" as never }), decision({ kind: "promote_challenger", state: "applied", payload: { loser: AD }, applied_at: "2026-09-11T15:00:00.000Z" })])).toBe("applied");
  });

  it("ignores a decision applied before this episode began", () => {
    expect(engineClaim(pause(), [decision({ state: "applied", applied_at: "2026-09-01T15:00:00.000Z" })])).toBe("none");
  });
});

describe("whether the pause is still OPS's own", () => {
  it("finds the guardrail's own commit inside the window it recorded (the real 2026-09-10 event)", () => {
    expect(pauseProvenance(pause(), [event()])).toBe("ours");
  });

  it("sees any later change to the ad as someone else's decision (the real 2026-09-11 manual restore)", () => {
    const restore = event({ micros: 1789124141209039, oldStatus: "PAUSED", newStatus: "ENABLED" });
    expect(pauseProvenance(pause(), [event(), restore])).toBe("touched");
    const pausedAgain = event({ micros: 1789124141209039, clientType: "GOOGLE_ADS_WEB_CLIENT", oldStatus: "PAUSED", newStatus: "PAUSED" });
    expect(pauseProvenance(pause(), [event(), pausedAgain])).toBe("touched");
  });

  it("ignores other ads and anything before its own pause", () => {
    const create = event({ micros: 1789017638036560, operation: "CREATE", oldStatus: null, newStatus: "ENABLED" });
    const other = event({ micros: 1789124141209039, resourceName: "customers/4454506598/adGroupAds/1~2", newStatus: "ENABLED" });
    expect(pauseProvenance(pause(), [create, event(), other])).toBe("ours");
  });

  it("cannot vouch for a pause whose own commit is missing or falls outside its window", () => {
    expect(pauseProvenance(pause(), [])).toBe("unknown");
    expect(pauseProvenance(pause(), [event({ micros: 1789052369290063 + 5 * 60_000_000 })])).toBe("unknown");
    expect(pauseProvenance(pause({ pause_requested_at: null, paused_at: null }), [event()])).toBe("unknown");
  });
});

describe("the change-history window", () => {
  it("covers the day before the earliest pause through tomorrow, in the account's Vancouver dates", () => {
    expect(changeWindow([pause()], new Date("2026-09-11T14:59:05.000Z"))).toEqual({ startDate: "2026-09-09", endDate: "2026-09-12" });
  });

  it("never asks for a start older than Google allows", () => {
    const old = pause({ pause_requested_at: "2026-07-01T15:00:00.000Z", paused_at: "2026-07-01T15:00:01.000Z" });
    expect(changeWindow([old, pause()], new Date("2026-09-11T14:59:05.000Z")).startDate).toBe("2026-08-13");
  });
});

describe("when a replacement is really coming", () => {
  it("is due when the paused ad's group still has its enabled control and no running test", () => {
    expect(replacementDue({ adResourceName: R.jmChallenger, adGroupResourceName: R.jobManagement, policyTopics: ["TRADEMARKS_IN_AD_TEXT"], snapshot: snapshot(), tests: [], pauses: [] })).toBe(true);
  });

  it("is not due for a landing-page verdict: a new ad on the same page fails the same way", () => {
    expect(replacementDue({ adResourceName: R.jmChallenger, adGroupResourceName: R.jobManagement, policyTopics: ["DESTINATION_NOT_WORKING"], snapshot: snapshot(), tests: [], pauses: [] })).toBe(false);
    // A copy problem alongside it is still worth a rewrite.
    expect(replacementDue({ adResourceName: R.jmChallenger, adGroupResourceName: R.jobManagement, policyTopics: ["DESTINATION_NOT_WORKING", "MISLEADING_AD_DESIGN"], snapshot: snapshot(), tests: [], pauses: [] })).toBe(true);
  });

  it("is not due while the group has a running test, because the validator refuses a second one", () => {
    const running = tests().map((t) => (t.ad_group_id === "21" ? { ...t, state: "running" as const } : t));
    expect(replacementDue({ adResourceName: R.jmChallenger, adGroupResourceName: R.jobManagement, policyTopics: ["TRADEMARKS_IN_AD_TEXT"], snapshot: snapshot(), tests: running, pauses: [] })).toBe(false);
  });

  it("is not due when the paused ad was the control, because a challenger needs a control to test against", () => {
    expect(replacementDue({ adResourceName: R.jmControl, adGroupResourceName: R.jobManagement, policyTopics: ["TRADEMARKS_IN_AD_TEXT"], snapshot: snapshot(), tests: [], pauses: [] })).toBe(false);
  });

  it("is not due while the campaign or the group is paused, because the brief only names groups that serve", () => {
    const pausedCampaign = snapshot();
    pausedCampaign.campaigns = pausedCampaign.campaigns.map((c) => (c.resourceName === R.core ? { ...c, status: "PAUSED" as const } : c));
    expect(replacementDue({ adResourceName: R.jmChallenger, adGroupResourceName: R.jobManagement, policyTopics: ["TRADEMARKS_IN_AD_TEXT"], snapshot: pausedCampaign, tests: [], pauses: [] })).toBe(false);
    const pausedGroup = snapshot();
    pausedGroup.adGroups = pausedGroup.adGroups.map((g) => (g.resourceName === R.jobManagement ? { ...g, status: "PAUSED" as const } : g));
    expect(replacementDue({ adResourceName: R.jmChallenger, adGroupResourceName: R.jobManagement, policyTopics: ["TRADEMARKS_IN_AD_TEXT"], snapshot: pausedGroup, tests: [], pauses: [] })).toBe(false);
  });

  it("is not due while the group still runs another challenger, because a group tests one at a time", () => {
    // 208 is a paused challenger beside the enabled pair 201/202 in Job management.
    expect(replacementDue({ adResourceName: R.pausedAd, adGroupResourceName: R.jobManagement, policyTopics: ["TRADEMARKS_IN_AD_TEXT"], snapshot: snapshot(), tests: [], pauses: [] })).toBe(false);
    // Held for a landing page, the other challenger is still in place: the guardrail brings it back.
    const landing = [pause({ ad_resource_name: R.jmChallenger, ad_id: "202", ad_group_resource_name: R.jobManagement })];
    expect(replacementDue({ adResourceName: R.pausedAd, adGroupResourceName: R.jobManagement, policyTopics: ["TRADEMARKS_IN_AD_TEXT"], snapshot: snapshot(), tests: [], pauses: landing })).toBe(false);
  });

  it("is due once the other challenger is itself held for its copy", () => {
    const copy = [pause({ ad_resource_name: R.jmChallenger, ad_id: "202", ad_group_resource_name: R.jobManagement, policy_topics: ["TRADEMARKS_IN_AD_TEXT"] })];
    expect(replacementDue({ adResourceName: R.pausedAd, adGroupResourceName: R.jobManagement, policyTopics: ["TRADEMARKS_IN_AD_TEXT"], snapshot: snapshot(), tests: [], pauses: copy })).toBe(true);
  });
});

describe("the challenger a group already has in place", () => {
  it("is the group's enabled challenger", () => {
    expect(challengerInPlace(snapshot(), R.jobManagement, [])?.id).toBe("202");
    expect(challengerInPlace(snapshot(), R.crewScheduling, [])).toBeNull();
  });

  it("is still in place while the guardrail holds it for a landing page, even once the snapshot shows it paused", () => {
    const snap = snapshot();
    snap.ads = snap.ads.map((ad) => (ad.resourceName === R.jmChallenger ? { ...ad, status: "PAUSED" as const } : ad));
    const landing = [pause({ ad_resource_name: R.jmChallenger, ad_id: "202", ad_group_resource_name: R.jobManagement })];
    expect(challengerInPlace(snap, R.jobManagement, landing)?.id).toBe("202");
  });

  it("is gone once the guardrail holds it for its copy, even while the snapshot still shows it enabled", () => {
    const copy = [pause({ ad_resource_name: R.jmChallenger, ad_id: "202", ad_group_resource_name: R.jobManagement, policy_topics: ["TRADEMARKS_IN_AD_TEXT"] })];
    expect(challengerInPlace(snapshot(), R.jobManagement, copy)).toBeNull();
  });

  it("is still in place while a verdict is only being held, because the ad has not been paused", () => {
    const holding = [pause({ ad_resource_name: R.jmChallenger, ad_id: "202", ad_group_resource_name: R.jobManagement, policy_topics: ["TRADEMARKS_IN_AD_TEXT"], state: "holding" })];
    expect(challengerInPlace(snapshot(), R.jobManagement, holding)?.id).toBe("202");
  });

  it("follows the routine: it has checked in within the stall window and challengers are not switched off", () => {
    expect(routineActive(settings({ heartbeat_at: "2026-10-19T15:00:00.000Z" }), NOW)).toBe(true);
    expect(routineActive(settings({ heartbeat_at: null }), NOW)).toBe(false);
    expect(routineActive(settings({ heartbeat_at: "2026-10-18T13:00:00.000Z" }), NOW)).toBe(false);
    expect(routineActive(settings({ modes: { ...settings().modes, create_rsa_challenger: "off" } }), NOW)).toBe(false);
  });
});

describe("the blueprint's retire list", () => {
  it("reads the retired ad ids", () => {
    expect(retiredAdIdsFrom(() => ({ retire: { adIds: ["824125294531", "824125294537"] } }))).toEqual(new Set(["824125294531", "824125294537"]));
  });

  it("is unknown, never empty, when the blueprint cannot be read — so nothing is switched back on", () => {
    expect(
      retiredAdIdsFrom(() => {
        throw new Error("BLUEPRINT_INVALID");
      })
    ).toBeNull();
  });

  it("holds the eleven challengers retired on 2026-09-11 in the committed blueprint", () => {
    const retired = retiredAdIdsFrom(loadBlueprint);
    expect(retired?.size).toBe(11);
    for (const id of ["824125294531", "824125294537", "824125294543", "824125294549", "824125294555", "824125294681", "824125294687", "824125294693", "824125294699", "824125294705", "824125294711"])
      expect(retired?.has(id)).toBe(true);
    // The eleven controls the guardrail also paused on 2026-09-10 are not retired.
    expect(retired?.has("824125294528")).toBe(false);
  });
});

describe("alert copy", () => {
  it("names Google's reason in plain words", () => {
    expect(policyReason(["TRADEMARKS_IN_AD_TEXT"])).toBe("trademarks in ad text");
    expect(policyReason(["MISLEADING_AD_DESIGN", "UNRELIABLE_CLAIMS"])).toBe("misleading ad design and unreliable claims");
    expect(policyReason([])).toBe("a policy issue");
  });

  it("promises nothing the engine does not do", () => {
    expect(pausedAlert({ adGroupName: "Jobber pricing", topics: ["DESTINATION_NOT_WORKING"], replacement: false })).toEqual({
      title: "AD DISAPPROVED",
      body: "Google says the landing page for an ad in Jobber pricing is not working. OPS paused the ad and turns it back on once Google approves it. If the page loads, appeal in Google Ads.",
    });
    expect(pausedAlert({ adGroupName: "Switching", topics: ["TRADEMARKS_IN_AD_TEXT"], replacement: false })).toEqual({
      title: "AD DISAPPROVED",
      body: "Google disapproved an ad in Switching for trademarks in ad text. OPS paused it and turns it back on once Google approves it.",
    });
  });

  it("promises a replacement only when one is coming", () => {
    expect(pausedAlert({ adGroupName: "Switching", topics: ["TRADEMARKS_IN_AD_TEXT"], replacement: true }).body).toBe(
      "Google disapproved an ad in Switching for trademarks in ad text. OPS paused it and turns it back on once Google approves it. The engine writes a replacement for your review on its next run."
    );
  });

  it("says what failed and what happens next", () => {
    expect(pauseFailedAlert({ adGroupName: "Roofing", topics: ["UNRELIABLE_CLAIMS"], error: "RESOURCE_NOT_FOUND" })).toEqual({
      title: "AD DISAPPROVED",
      body: "Google disapproved an ad in Roofing for unreliable claims. OPS could not pause it (RESOURCE_NOT_FOUND) and tries again tomorrow.",
    });
    expect(pauseFailedAlert({ adGroupName: "Roofing", topics: ["DESTINATION_NOT_WORKING"], error: "RESOURCE_NOT_FOUND" }).body).toBe(
      "Google says the landing page for an ad in Roofing is not working. OPS could not pause the ad (RESOURCE_NOT_FOUND) and tries again tomorrow."
    );
    expect(restoreFailedAlert({ adGroupName: "Pricing", error: "ACTION_NOT_PERMITTED" })).toEqual({
      title: "AD STILL PAUSED",
      body: "Google approved the ad OPS paused in Pricing. OPS could not switch it back on (ACTION_NOT_PERMITTED) and tries again tomorrow.",
    });
  });

  it("closes the loop in one line when ads go back on", () => {
    expect(restoredAlert(["Pricing"])).toEqual({ title: "AD BACK ON", body: "Google approved the ad OPS paused in Pricing. OPS switched it back on." });
    expect(restoredAlert(["Pricing", "Roofing", "Pricing"])).toEqual({ title: "ADS BACK ON", body: "Google approved 3 ads OPS paused in Pricing and Roofing. OPS switched them back on." });
    expect(restoredAlert(["A", "B", "C", "D", "E"]).body).toBe("Google approved 5 ads OPS paused in A, B, C and 2 more. OPS switched them back on.");
  });

  it("never shouts and always fits the rail", () => {
    const long = "x".repeat(400);
    for (const alert of [
      pausedAlert({ adGroupName: long, topics: ["DESTINATION_NOT_WORKING"], replacement: true }),
      pauseFailedAlert({ adGroupName: long, topics: ["A_B"], error: long }),
      restoreFailedAlert({ adGroupName: long, error: long }),
      restoredAlert([long, long + "y"]),
    ]) {
      expect(alert.body.length).toBeLessThanOrEqual(600);
      expect(alert.body).not.toMatch(/!/);
    }
  });

  it("keys every alert to one guardrail episode, inside the outbox's dedupe rule", () => {
    const id = pause().id;
    const keys = [alertKeys.paused(id), alertKeys.pauseFailed(id), alertKeys.restoreFailed(id), alertKeys.restored([id, "0b2f7e3a-1c4d-4e5f-8a9b-0c1d2e3f4a5b"])];
    for (const key of keys) {
      expect(key).toMatch(/^ads-engine:[A-Za-z0-9 _:./~·-]+$/);
      expect(key.length).toBeLessThanOrEqual(320);
    }
    expect(new Set(keys).size).toBe(4);
    expect(alertKeys.restored(["b", "a"])).toBe(alertKeys.restored(["a", "b"]));
  });
});
