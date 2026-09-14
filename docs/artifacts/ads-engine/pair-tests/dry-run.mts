// What the pair-test fix does to the real account today, read from production
// and written nowhere (GOOGLE ADS ENGINE - P2-1-1-1). Extended by P2-1-1-1-1 to
// ask the copy rules on their own (`copyRulesAskedOnTheirOwn`).
//
//   node --conditions=react-server --import tsx docs/artifacts/ads-engine/pair-tests/dry-run.mts > docs/artifacts/ads-engine/pair-tests/dry-run-2026-09-14.json
//   node --conditions=react-server --import tsx docs/artifacts/ads-engine/pair-tests/dry-run.mts > docs/artifacts/ads-engine/copy-kinds/dry-run-after-2026-09-14.json
//
// Every request goes through a fetch that refuses anything but GET and HEAD,
// so the run cannot write to the database even by mistake. It reads the same
// rows the worker tick and the handoff read, then asks the new rules — the
// code on this branch, not a copy — what they would do.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { EngineRepository } from "@/lib/ads/engine/repository";

// The app's modules are CommonJS to Node: their exports sit on `default`.
const load = async <T,>(path: string): Promise<T> => {
  const mod = (await import(path)) as { default?: unknown };
  return (mod.default && typeof mod.default === "object" ? mod.default : mod) as T;
};
const { createEngineRepository } = await load<{ createEngineRepository: (client: unknown) => EngineRepository }>("@/lib/ads/engine/repository");
const { livePairs, untrackedPairs, staleTests, pairTest } = await load<typeof import("@/lib/ads/engine/pairs")>("@/lib/ads/engine/pairs");
const { computeDuties } = await load<typeof import("@/lib/ads/engine/brief")>("@/lib/ads/engine/brief");
const { validateProposal } = await load<typeof import("@/lib/ads/engine/validate-proposal")>("@/lib/ads/engine/validate-proposal");
const { planBlueprint } = await load<typeof import("@/lib/ads/blueprint-planner")>("@/lib/ads/blueprint-planner");
const { parseBlueprint } = await load<typeof import("@/lib/ads/blueprint")>("@/lib/ads/blueprint");
const { metricWindows } = await load<typeof import("@/lib/ads/engine/metrics")>("@/lib/ads/engine/metrics");
const { BRAND_FACTS } = await load<typeof import("@/lib/ads/copy-rules")>("@/lib/ads/copy-rules");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")])
);

const refused: string[] = [];
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        refused.push(`${method} ${String(input)}`);
        return Promise.reject(new Error(`read-only dry run refused ${method}`));
      }
      return fetch(input, init);
    },
  },
});
const repository = createEngineRepository(client);
const now = new Date();

const [snapshot, running, pauses, inputs] = await Promise.all([
  repository.readSnapshot(),
  repository.listRunningTests(),
  repository.listOpenGuardrailPauses(),
  repository.validationContext(),
]);

// ─── The worker's new step ───────────────────────────────────────────────────
const stale = staleTests({ running, snapshot, pauses });
const pairs = livePairs(snapshot, pauses);
const history = await repository.listPairTests([...new Set(pairs.map((pair) => pair.adGroup.id))]);
const untracked = untrackedPairs(pairs, history);
const adoption = [];
for (const pair of untracked) {
  const firstSharedDay = await repository.firstSharedServingDay(pair.control.id, pair.challenger.id, pair.since);
  adoption.push({
    campaign: pair.campaign.name,
    campaignStatus: pair.campaign.status,
    adGroup: pair.adGroup.name,
    control: pair.control.id,
    challenger: pair.challenger.id,
    since: pair.since,
    firstSharedDay,
    wouldOpen: firstSharedDay ? pairTest(pair, firstSharedDay) : null,
  });
}

// ─── The brief's creative duty, as if every engine campaign were live ───────
const live = { ...snapshot, campaigns: snapshot.campaigns.map((c) => (c.labels.includes("engine") && c.kind !== "legacy" ? { ...c, status: "ENABLED" as const } : c)) };
const window = metricWindows(now).metrics28d;
const agedControls = {
  ...inputs.metrics28d,
  // Every control first seen 60 days ago: the cadence rule is met everywhere.
  ads: live.ads.filter((ad) => ad.role === "control").map((ad) => ({ adId: ad.id, adGroupId: ad.adGroupResourceName.split("/").pop() ?? "", clicks: 0, impressions: 0, spend: 0, conversions: 0, ctr: 0, approvalStatus: ad.approvalStatus, adStrength: null, firstSeen: new Date(now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10), days: 28 })),
};
const duties = computeDuties({ now, snapshot: live, metrics28d: agedControls, tests: history, runsThisMonth: [{ duties: ["structure"], state: "released" }], funnel: inputs.funnel, guardrailPauses: pauses });

// ─── The validator, asked for a third ad in every group ──────────────────────
// The proposal is as real as the routine could make it: the group's own
// approved challenger copy, on the group's own page, against the handoff's
// real URL allowlist — so the only thing that can refuse it is the new rule.
const validator = pairs.map((pair) => {
  const verdict = validateProposal(
    {
      kind: "create_rsa_challenger",
      rationale: "dry run",
      evidence: [],
      payload: {
        ad_group: pair.adGroup.resourceName,
        hypothesis: "dry run",
        headlines: pair.challenger.headlines,
        descriptions: pair.challenger.descriptions,
        ...(pair.challenger.path1 ? { path1: pair.challenger.path1 } : {}),
        ...(pair.challenger.path2 ? { path2: pair.challenger.path2 } : {}),
        final_url: pair.adGroup.finalUrl ?? pair.control.finalUrls[0],
      },
    },
    { ...inputs, snapshot: live, allowedFinalUrls: BRAND_FACTS.allowedFinalUrls, structuralAcceptedThisRun: 0, now }
  );
  return { adGroup: `${pair.campaign.name} › ${pair.adGroup.name}`, ok: verdict.ok, code: verdict.ok ? null : verdict.code, message: verdict.ok ? null : verdict.issues[0]?.message };
});

// ─── The copy rules, asked on their own (GOOGLE ADS ENGINE - P2-1-1-1-1) ─────
// The one-challenger rule refuses a third ad before the copy is read, so it
// hides the copy question. Asked on its own: the group's challenger retired
// (the moment the routine writes the next one), the group's own approved
// challenger copy resubmitted on its own page. Every group must accept it.
const retiredChallenger = (pair: (typeof pairs)[number]) => ({
  ...live,
  ads: live.ads.map((ad) => (ad.resourceName === pair.challenger.resourceName ? { ...ad, status: "PAUSED" as const } : ad)),
});
const ask = (pair: (typeof pairs)[number], headlines: typeof pair.challenger.headlines) => {
  const verdict = validateProposal(
    {
      kind: "create_rsa_challenger",
      rationale: "dry run",
      evidence: [],
      payload: {
        ad_group: pair.adGroup.resourceName,
        hypothesis: "dry run",
        headlines,
        descriptions: pair.challenger.descriptions,
        ...(pair.challenger.path1 ? { path1: pair.challenger.path1 } : {}),
        ...(pair.challenger.path2 ? { path2: pair.challenger.path2 } : {}),
        final_url: pair.adGroup.finalUrl ?? pair.control.finalUrls[0],
      },
    },
    { ...inputs, snapshot: retiredChallenger(pair), tests: [], allowedFinalUrls: BRAND_FACTS.allowedFinalUrls, structuralAcceptedThisRun: 0, now }
  );
  return verdict.ok
    ? { ok: true, code: null, issues: [] as string[], copyKind: (verdict.normalized.payload as { copyKind?: string }).copyKind ?? null }
    : { ok: false, code: verdict.code, issues: verdict.issues.map((issue) => `${issue.code} ${issue.field}: ${issue.message}`), copyKind: null };
};
const namesCompetitor = (texts: string[]) => BRAND_FACTS.competitors.names.some((name) => texts.some((text) => text.toLowerCase().includes(name.toLowerCase())));
const copyRules = pairs.map((pair) => {
  const own = ask(pair, pair.challenger.headlines);
  // The negative control: a competitor name dropped into a group that may not
  // carry one must still be refused. The last unpinned headline makes way.
  const swapAt = pair.challenger.headlines.map((h, i) => (h.pinnedField ? -1 : i)).filter((i) => i >= 0).pop() ?? 0;
  const planted = pair.challenger.headlines.map((h, i) => (i === swapAt ? { text: "Switching from Jobber?" } : h));
  const plantedVerdict = pair.adGroup.copyKind === "competitor" ? null : ask(pair, planted);
  return {
    adGroup: `${pair.campaign.name} › ${pair.adGroup.name}`,
    campaignKind: pair.campaign.kind,
    copyKind: pair.adGroup.copyKind ?? null,
    landingPage: pair.adGroup.finalUrl,
    ownCopyNamesACompetitor: namesCompetitor([...pair.challenger.headlines, ...pair.challenger.descriptions].map((a) => a.text)),
    ownChallengerCopy: own,
    competitorNamePlanted: plantedVerdict,
  };
});

// ─── The committed blueprint against the live account ───────────────────────
const blueprint = parseBlueprint(JSON.parse(readFileSync("config/ads/blueprint.json", "utf8")));
let blueprintPlan: { operations: number; error: string | null };
try {
  blueprintPlan = { operations: planBlueprint(blueprint, snapshot).length, error: null };
} catch (error) {
  blueprintPlan = { operations: 0, error: error instanceof Error ? error.message : String(error) };
}

console.log(
  JSON.stringify(
    {
      ranAt: now.toISOString(),
      snapshotAt: snapshot.snapshotAt,
      readOnly: { refusedWrites: refused },
      window,
      worker: {
        runningTests: running.length,
        openGuardrailEpisodes: pauses.length,
        testsToCancel: stale.map(({ test, reason }) => ({ id: test.id, adGroup: test.ad_group_name, reason })),
        livePairs: pairs.length,
        testHistoryForThoseGroups: history.length,
        untrackedPairs: untracked.length,
        testsToOpen: adoption.filter((entry) => entry.wouldOpen).length,
        pairs: adoption,
      },
      briefIfEveryCampaignWereLive: { duties: duties.duties, creative: duties.notes.creative ?? null },
      validatorAskedForAThirdAd: validator,
      snapshotKinds: {
        campaigns: snapshot.campaigns.filter((c) => c.labels.includes("engine")).map((c) => ({ name: c.name, kind: c.kind })),
        adGroups: snapshot.adGroups.filter((g) => pairs.some((pair) => pair.adGroup.resourceName === g.resourceName)).map((g) => ({ name: g.name, copyKind: g.copyKind ?? null, finalUrl: g.finalUrl })),
      },
      copyRulesAskedOnTheirOwn: {
        ownChallengerAccepted: copyRules.filter((entry) => entry.ownChallengerCopy.ok).length,
        ownChallengerCopyRejected: copyRules.filter((entry) => entry.ownChallengerCopy.code === "COPY_REJECTED").map((entry) => entry.adGroup),
        ownChallengerOtherRefusals: copyRules.filter((entry) => !entry.ownChallengerCopy.ok && entry.ownChallengerCopy.code !== "COPY_REJECTED").map((entry) => ({ adGroup: entry.adGroup, code: entry.ownChallengerCopy.code })),
        plantedNameRefusedWithTrademarkCampaign: copyRules.filter((entry) => entry.competitorNamePlanted?.issues.some((issue) => issue.startsWith("TRADEMARK_CAMPAIGN"))).length,
        plantedNameAsked: copyRules.filter((entry) => entry.competitorNamePlanted).length,
        groups: copyRules,
      },
      committedBlueprint: { version: blueprint.version, structuralOperations: blueprintPlan.operations, error: blueprintPlan.error },
    },
    null,
    2
  )
);
