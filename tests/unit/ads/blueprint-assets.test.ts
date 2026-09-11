import { describe, expect, it, vi } from "vitest";
import { loadBlueprint, parseBlueprint, BlueprintError, type Blueprint } from "@/lib/ads/blueprint";
import {
  EMPTY_ASSET_STATE,
  mapAssetState,
  planAssets,
  type LiveAssetState,
} from "@/lib/ads/blueprint-assets";
import type { PlannedOperation } from "@/lib/ads/blueprint-planner";

const CID = "4454506598";
const blueprint = loadBlueprint();

/** The five engine campaigns as Google would report them, before any assets. */
function bareAccount(): LiveAssetState {
  return {
    campaigns: blueprint.campaigns.map((c, i) => ({
      resourceName: `customers/${CID}/campaigns/${1000 + i}`,
      name: c.name,
      automation: [{ type: "TEXT_ASSET_AUTOMATION", status: "OPTED_OUT" }],
    })),
    campaignAssets: [],
    customerAssets: blueprint.retire.customerAssets.map((r) => ({
      resourceName: `customers/${CID}/customerAssets/${r.assetId}~${r.fieldType}`,
      assetId: r.assetId,
      fieldType: r.fieldType,
      status: "ENABLED",
    })),
    assets: [],
  };
}

/**
 * The committed blueprint with an image set injected. Image mechanics are
 * tested on this fixture, not on whatever images happen to be approved today —
 * the committed file carries none while Jackson's second look is pending.
 */
function withImages(): Blueprint {
  const raw = JSON.parse(JSON.stringify(blueprint));
  raw.images = {
    ...raw.images,
    T_upload_wide: { file: "config/ads/images/glove-app-1.91.jpg", name: "OPS · test upload · 1.91:1", aspect: "1.91:1", approvedBy: "Jackson", approvedAt: "2026-09-10" },
    T_logo: { file: "config/ads/images/ops-business-logo-1200.png", name: "OPS · test logo", aspect: "logo", approvedBy: "Jackson", approvedAt: "2026-09-10" },
  };
  for (const c of raw.campaigns) {
    c.assets.images = ["T_upload_wide", "B_autodetail_wide", "C_toolbelt_wide", "D_hardhat_wide"];
    c.assets.businessLogo = "T_logo";
  }
  return parseBlueprint(raw);
}

const kind = (op: PlannedOperation) => Object.keys(op.op)[0];
const stubImage = vi.fn(() => "aGVsbG8=");

/** Plays a plan into the live state the way Google would, so a re-plan can be checked. */
function simulate(plan: PlannedOperation[], before: LiveAssetState): LiveAssetState {
  const live: LiveAssetState = structuredClone(before);
  const realName = new Map<string, string>();
  let nextId = 900_000;
  const typeOf = (body: Record<string, unknown>) =>
    body.sitelinkAsset ? "SITELINK" : body.calloutAsset ? "CALLOUT" : body.structuredSnippetAsset ? "STRUCTURED_SNIPPET"
    : body.textAsset ? "TEXT" : body.priceAsset ? "PRICE" : "IMAGE";
  for (const entry of plan) {
    const op = entry.op as Record<string, Record<string, unknown>>;
    if (op.assetOperation?.create) {
      const body = op.assetOperation.create as Record<string, unknown>;
      const id = String(nextId++);
      const resourceName = `customers/${CID}/assets/${id}`;
      realName.set(String(body.resourceName), resourceName);
      const mapped = mapAssetState({ campaigns: [], campaignAssets: [], customerAssets: [], assets: [{ asset: { ...body, id, resourceName, type: typeOf(body) } }] });
      live.assets.push(mapped.assets[0]);
    }
    if (op.campaignAssetOperation?.create) {
      const c = op.campaignAssetOperation.create as { campaign: string; asset: string; fieldType: string };
      const asset = realName.get(c.asset) ?? c.asset;
      const known = live.assets.find((a) => a.resourceName === asset) ?? {
        resourceName: asset, id: asset.split("/").pop()!, type: "IMAGE", name: null, key: `IMAGE#${asset.split("/").pop()}`,
      };
      live.campaignAssets.push({ resourceName: `${c.campaign}~${asset}~${c.fieldType}`, campaignResourceName: c.campaign, fieldType: c.fieldType, status: "ENABLED", asset: known });
    }
    if (op.campaignAssetOperation?.update) {
      const u = op.campaignAssetOperation.update as { resourceName: string; status: string };
      const link = live.campaignAssets.find((l) => l.resourceName === u.resourceName)!;
      link.status = u.status;
    }
    if (op.campaignOperation?.update) {
      const u = op.campaignOperation.update as { resourceName: string; assetAutomationSettings: Array<{ assetAutomationType: string; assetAutomationStatus: string }> };
      live.campaigns.find((c) => c.resourceName === u.resourceName)!.automation = u.assetAutomationSettings.map((s) => ({ type: s.assetAutomationType, status: s.assetAutomationStatus }));
    }
    if (op.customerAssetOperation?.update) {
      const u = op.customerAssetOperation.update as { resourceName: string; status: string };
      live.customerAssets.find((c) => c.resourceName === u.resourceName)!.status = u.status;
    }
  }
  return live;
}

describe("planAssets", () => {
  it("does nothing for campaigns that do not exist yet", () => {
    expect(planAssets(blueprint, EMPTY_ASSET_STATE, stubImage)).toEqual([]);
  });

  it("dresses a bare account: creates each asset once, links it everywhere it belongs", () => {
    stubImage.mockClear();
    const plan = planAssets(blueprint, bareAccount(), stubImage);
    const creates = plan.filter((e) => kind(e) === "assetOperation");
    const links = plan.filter((e) => kind(e) === "campaignAssetOperation");
    // Callouts are identical across the five campaigns: created once, linked five times.
    const callouts = creates.filter((e) => JSON.stringify(e.op).includes("calloutAsset"));
    expect(callouts).toHaveLength(8);
    expect(links.filter((e) => JSON.stringify(e.op).includes('"fieldType":"CALLOUT"'))).toHaveLength(40);
    // The committed blueprint carries no image while Jackson's second look is pending.
    expect(creates.filter((e) => JSON.stringify(e.op).includes("imageAsset"))).toEqual([]);
    expect(links.filter((e) => /"fieldType":"(AD_IMAGE|BUSINESS_LOGO)"/.test(JSON.stringify(e.op)))).toEqual([]);
    expect(stubImage).not.toHaveBeenCalled();
    // Every asset is created before anything links to it.
    const firstLink = plan.findIndex((e) => kind(e) === "campaignAssetOperation");
    const lastCreate = plan.map(kind).lastIndexOf("assetOperation");
    expect(lastCreate).toBeLessThan(firstLink);
  });

  it("uploads each new image once, however many campaigns use it", () => {
    stubImage.mockClear();
    const plan = planAssets(withImages(), bareAccount(), stubImage);
    const uploads = plan.filter((e) => JSON.stringify(e.op).includes("imageAsset"));
    expect(uploads).toHaveLength(2);
    expect(stubImage).toHaveBeenCalledTimes(2);
    expect(stubImage.mock.calls.map((c) => c[0]).sort()).toEqual(["T_logo", "T_upload_wide"]);
    expect(plan.filter((e) => JSON.stringify(e.op).includes('"fieldType":"BUSINESS_LOGO"'))).toHaveLength(5);
  });

  it("plans nothing, and uploads nothing, against an account it already dressed with images", () => {
    const fixture = withImages();
    const dressed = simulate(planAssets(fixture, bareAccount(), stubImage), bareAccount());
    stubImage.mockClear();
    expect(planAssets(fixture, dressed, stubImage)).toEqual([]);
    expect(stubImage).not.toHaveBeenCalled();
  });

  it("reuses the approved images already in the account instead of uploading them again", () => {
    const plan = planAssets(withImages(), bareAccount(), stubImage);
    const imageLinks = plan
      .filter((e) => JSON.stringify(e.op).includes('"fieldType":"AD_IMAGE"'))
      .map((e) => (e.op.campaignAssetOperation!.create as { asset: string }).asset);
    for (const key of ["B_autodetail_wide", "C_toolbelt_wide", "D_hardhat_wide"])
      expect(imageLinks).toContain(`customers/${CID}/assets/${blueprint.images[key].existingAssetId}`);
  });

  it("prices in CAD micros, per month, only on the three campaigns that answer price searches", () => {
    const plan = planAssets(blueprint, bareAccount(), stubImage);
    const price = plan.filter((e) => JSON.stringify(e.op).includes('"fieldType":"PRICE"'));
    expect(price).toHaveLength(3);
    const create = plan.find((e) => JSON.stringify(e.op).includes("priceAsset"))!;
    const offerings = (create.op.assetOperation!.create as { priceAsset: { priceOfferings: Array<{ price: { currencyCode: string; amountMicros: string }; unit: string }> } }).priceAsset.priceOfferings;
    expect(offerings.map((o) => o.price.amountMicros)).toEqual(["90000000", "140000000", "190000000"]);
    expect(new Set(offerings.map((o) => o.price.currencyCode))).toEqual(new Set(["CAD"]));
    expect(new Set(offerings.map((o) => o.unit))).toEqual(new Set(["PER_MONTH"]));
  });

  it("changes no automation setting that is already where the blueprint wants it", () => {
    // Text automation is already opted out on all five campaigns. Image
    // extraction cannot be set per campaign on Search: Google refused it and
    // GENERATE_IMAGE_ENHANCEMENT with ENUM_VALUE_NOT_PERMITTED (dry run,
    // 2026-09-10) — on Search it follows the account-level dynamic images control.
    const plan = planAssets(blueprint, bareAccount(), stubImage);
    expect(plan.filter((e) => kind(e) === "campaignOperation")).toEqual([]);
    for (const c of blueprint.campaigns) {
      expect(Object.keys(c.assets!.automation ?? {}), c.name).not.toContain("GENERATE_IMAGE_EXTRACTION");
      expect(Object.keys(c.assets!.automation ?? {}), c.name).not.toContain("GENERATE_IMAGE_ENHANCEMENT");
    }
  });

  it("writes an automation update only when a campaign drifts from the blueprint", () => {
    const drifted = bareAccount();
    drifted.campaigns[0].automation = [{ type: "TEXT_ASSET_AUTOMATION", status: "OPTED_IN" }];
    const updates = planAssets(blueprint, drifted, stubImage).filter((e) => kind(e) === "campaignOperation");
    expect(updates).toHaveLength(1);
    expect(updates[0].op.campaignOperation!.update).toMatchObject({
      assetAutomationSettings: [{ assetAutomationType: "TEXT_ASSET_AUTOMATION", assetAutomationStatus: "OPTED_OUT" }],
    });
  });

  it("pauses the retired account-level sitelinks, never removes them", () => {
    const plan = planAssets(blueprint, bareAccount(), stubImage);
    const pauses = plan.filter((e) => kind(e) === "customerAssetOperation");
    expect(pauses).toHaveLength(blueprint.retire.customerAssets.length);
    for (const p of pauses) {
      expect(p.op.customerAssetOperation!.update).toMatchObject({ status: "PAUSED" });
      expect(p.op.customerAssetOperation!.updateMask).toBe("status");
    }
    expect(JSON.stringify(plan)).not.toMatch(/"remove"/);
  });

  it("plans nothing against the account it already dressed", () => {
    const dressed = simulate(planAssets(blueprint, bareAccount(), stubImage), bareAccount());
    stubImage.mockClear();
    expect(planAssets(blueprint, dressed, stubImage)).toEqual([]);
    expect(stubImage).not.toHaveBeenCalled();
  });

  it("re-enables a link someone paused rather than creating a duplicate", () => {
    const dressed = simulate(planAssets(blueprint, bareAccount(), stubImage), bareAccount());
    dressed.campaignAssets[0].status = "PAUSED";
    const plan = planAssets(blueprint, dressed, stubImage);
    expect(plan).toHaveLength(1);
    expect(plan[0].op.campaignAssetOperation!.update).toMatchObject({ status: "ENABLED" });
  });

  it("reuses an identical asset that already exists, even unlinked", () => {
    const first = planAssets(blueprint, bareAccount(), stubImage);
    const dressed = simulate(first, bareAccount());
    const withAssetsOnly: LiveAssetState = { ...bareAccount(), assets: dressed.assets };
    const plan = planAssets(blueprint, withAssetsOnly, stubImage);
    expect(plan.filter((e) => kind(e) === "assetOperation")).toEqual([]);
    expect(plan.filter((e) => kind(e) === "campaignAssetOperation").length).toBeGreaterThan(0);
  });
});

describe("mapAssetState", () => {
  it("reads Google's rows into content keys the planner can match", () => {
    const live = mapAssetState({
      campaigns: [{ campaign: { resourceName: "customers/1/campaigns/2", name: "X", assetAutomationSettings: [{ assetAutomationType: "TEXT_ASSET_AUTOMATION", assetAutomationStatus: "OPTED_OUT" }] } }],
      campaignAssets: [],
      customerAssets: [{ customerAsset: { resourceName: "customers/1/customerAssets/9~SITELINK", fieldType: "SITELINK", status: "ENABLED" }, asset: { id: "9" } }],
      assets: [
        { asset: { resourceName: "customers/1/assets/3", id: "3", type: "CALLOUT", calloutAsset: { calloutText: "No credit card" } } },
        { asset: { resourceName: "customers/1/assets/4", id: "4", type: "SITELINK", finalUrls: ["https://try.opsapp.co/for/cleaning/"], sitelinkAsset: { linkText: "Cleaning crews", description1: "A", description2: "B" } } },
      ],
    });
    expect(live.campaigns[0].automation).toEqual([{ type: "TEXT_ASSET_AUTOMATION", status: "OPTED_OUT" }]);
    expect(live.customerAssets[0]).toMatchObject({ assetId: "9", fieldType: "SITELINK", status: "ENABLED" });
    expect(live.assets[0].key).toBe("CALLOUT|No credit card");
    // A trailing slash on Google's copy of the URL still matches ours.
    expect(live.assets[1].key).toBe("SITELINK|Cleaning crews|A|B|https://try.opsapp.co/for/cleaning");
  });
});

describe("images answer to Jackson's rule", () => {
  it("every image in the committed blueprint records who approved it", () => {
    for (const [key, image] of Object.entries(blueprint.images)) {
      expect(image.approvedBy, key).toBe("Jackson");
      expect(image.approvedAt, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("the schema refuses an image with no approval record", () => {
    const raw = JSON.parse(JSON.stringify(blueprint));
    delete raw.images.B_autodetail_wide.approvedBy;
    expect(() => parseBlueprint(raw)).toThrowError(BlueprintError);
  });

  it("a campaign cannot use an image the blueprint has not approved", () => {
    const raw = JSON.parse(JSON.stringify(blueprint));
    raw.campaigns[0].assets.images.push("Z_never_seen");
    expect(() => parseBlueprint(raw)).toThrowError(/approved images/);
  });
});
