// The same two questions as dry-run.mts, asked of the code BEFORE the fix
// (feat/ads-engine-p2 at 1ad1fc685), against the same production rows.
// Run from a clean export of that commit; read-only like dry-run.mts.
//
//   node --conditions=react-server --import tsx dry-run-before.mts > dry-run-before-2026-09-14.json
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const load = async <T,>(path: string): Promise<T> => {
  const mod = (await import(path)) as { default?: unknown };
  return (mod.default && typeof mod.default === "object" ? mod.default : mod) as T;
};
type Repo = { readSnapshot(): Promise<any>; listOpenGuardrailPauses(): Promise<any[]>; validationContext(): Promise<any>; readTests(): Promise<any[]> };
const { createEngineRepository } = await load<{ createEngineRepository: (client: unknown) => Repo }>("@/lib/ads/engine/repository");
const { computeDuties } = await load<any>("@/lib/ads/engine/brief");
const { validateProposal } = await load<any>("@/lib/ads/engine/validate-proposal");
const { BRAND_FACTS } = await load<any>("@/lib/ads/copy-rules");

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")])
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
const [snapshot, pauses, inputs, tests] = await Promise.all([repository.readSnapshot(), repository.listOpenGuardrailPauses(), repository.validationContext(), repository.readTests()]);
const live = { ...snapshot, campaigns: snapshot.campaigns.map((c: any) => (c.labels.includes("engine") && c.kind !== "legacy" ? { ...c, status: "ENABLED" } : c)) };
const pairs = live.adGroups
  .map((adGroup: any) => {
    const campaign = live.campaigns.find((c: any) => c.resourceName === adGroup.campaignResourceName);
    const ads = live.ads.filter((ad: any) => ad.adGroupResourceName === adGroup.resourceName && ad.status === "ENABLED");
    return { campaign, adGroup, control: ads.find((ad: any) => ad.role === "control"), challenger: ads.find((ad: any) => ad.role === "challenger") };
  })
  .filter((pair: any) => pair.campaign?.labels.includes("engine") && pair.control && pair.challenger);
const agedControls = {
  ...inputs.metrics28d,
  ads: live.ads.filter((ad: any) => ad.role === "control").map((ad: any) => ({ adId: ad.id, adGroupId: ad.adGroupResourceName.split("/").pop(), clicks: 0, impressions: 0, spend: 0, conversions: 0, ctr: 0, approvalStatus: ad.approvalStatus, adStrength: null, firstSeen: new Date(now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10), days: 28 })),
};
const duties = computeDuties({ now, snapshot: live, metrics28d: agedControls, tests, runsThisMonth: [{ duties: ["structure"], state: "released" }], funnel: inputs.funnel, guardrailPauses: pauses });
const validator = pairs.map((pair: any) => {
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
  return { adGroup: `${pair.campaign.name} › ${pair.adGroup.name}`, ok: verdict.ok, code: verdict.ok ? null : verdict.code, message: verdict.ok ? null : verdict.issues[0]?.message, controlAdId: verdict.ok ? verdict.normalized.payload.controlAdId : null };
});
console.log(JSON.stringify({ ranAt: now.toISOString(), code: "1ad1fc685 (before the fix)", snapshotAt: snapshot.snapshotAt, readOnly: { refusedWrites: refused }, tests: tests.length, livePairs: pairs.length, briefIfEveryCampaignWereLive: { duties: duties.duties, creative: duties.notes.creative ?? null }, validatorAskedForAThirdAd: validator }, null, 2));
