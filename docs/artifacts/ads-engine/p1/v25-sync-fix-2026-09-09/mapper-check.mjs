import { mapEntitySnapshot } from "./snapshot.mjs";
const C = "customers/4454506598";
// Rows exactly as phase 1's queryEntitySnapshot -> upsertEntitySnapshot writes
// them: payload is the whole searchStream row, labels resolved, parent set.
const rows = [
  { resource_name: `${C}/campaigns/22263645060`, entity_type: "campaign", parent_resource_name: null, name: "OPS Join_Ops Page US", status: "PAUSED",
    payload: { campaign: { resourceName: `${C}/campaigns/22263645060`, id: "22263645060", name: "OPS Join_Ops Page US", status: "PAUSED", startDateTime: "2025-02-21 10:28:17" } }, labels: [], snapshot_at: null },
  { resource_name: `${C}/sharedSets/11814032032`, entity_type: "shared_set", parent_resource_name: null, name: "Competitors", status: "ENABLED",
    payload: { sharedSet: { resourceName: `${C}/sharedSets/11814032032`, id: "11814032032", name: "Competitors", type: "BRANDS", status: "ENABLED", memberCount: "4" } }, labels: [], snapshot_at: null },
  { resource_name: `${C}/sharedCriteria/11814032032~1`, entity_type: "shared_criterion", parent_resource_name: `${C}/sharedSets/11814032032`, name: "jobber", status: "",
    payload: { sharedCriterion: { resourceName: `${C}/sharedCriteria/11814032032~1`, sharedSet: `${C}/sharedSets/11814032032`, keyword: { text: "jobber", matchType: "BROAD" } } }, labels: [], snapshot_at: null },
  { resource_name: `${C}/campaignSharedSets/22263645060~11814032032`, entity_type: "campaign_shared_set", parent_resource_name: `${C}/campaigns/22263645060`, name: `${C}/sharedSets/11814032032`, status: "ENABLED",
    payload: { campaignSharedSet: { resourceName: `${C}/campaignSharedSets/22263645060~11814032032`, campaign: `${C}/campaigns/22263645060`, sharedSet: `${C}/sharedSets/11814032032`, status: "ENABLED" } }, labels: [], snapshot_at: null },
];
const snap = mapEntitySnapshot(rows);
const set = snap.sharedSets[0];
console.log("shared set        :", set.name, `(${set.members.map((m) => m.text).join(", ")})`);
console.log("attached campaigns:", JSON.stringify(set.campaignResourceNames));
const ok = set.campaignResourceNames.includes(`${C}/campaigns/22263645060`);
console.log(ok ? "\nPASS: the engine sees which campaign the negative list guards" : "\nFAIL: attachment not resolved");
process.exit(ok ? 0 : 1);
