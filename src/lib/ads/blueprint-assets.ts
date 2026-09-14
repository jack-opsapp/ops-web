/**
 * Google Ads account blueprint — the asset planner.
 *
 * Pure: blueprint + the account's live asset state → mutate operations. Assets
 * are everything around an ad: sitelinks, callouts, the structured snippet,
 * price tiers, the business name and logo, and images. They attach at campaign
 * level, which overrides anything attached at account level.
 *
 * The same two rules as the ad planner. Nothing is ever removed — an asset the
 * blueprint no longer wants is left alone, and a retired account-level asset is
 * paused, so its history stays readable. And it diffs by content, so a second
 * apply against an account it already dressed plans nothing: an identical
 * asset already in the account is reused rather than created again.
 *
 * Images are the exception to "the file is enough". Jackson's rule (2026-09-10)
 * is that no image reaches an ad until he has seen it, so every image in the
 * blueprint carries who approved it and when — the schema refuses one that
 * does not — and Google's own image extraction is opted out, so it cannot pick
 * pictures from our pages behind that rule.
 */
import type { Blueprint } from "./blueprint";
import { STAGES, type MutateOperation, type PlannedOperation } from "./blueprint-planner";

// ─── Live state ──────────────────────────────────────────────────────────────

export interface LiveAsset {
  resourceName: string;
  id: string;
  type: string;
  name: string | null;
  /** Content identity for reuse and diffing; null for types we do not author. */
  key: string | null;
}

export interface LiveCampaignAsset {
  resourceName: string;
  campaignResourceName: string;
  fieldType: string;
  status: string;
  asset: LiveAsset;
}

export interface LiveCustomerAsset {
  resourceName: string;
  assetId: string;
  fieldType: string;
  status: string;
}

export interface LiveCampaign {
  resourceName: string;
  name: string;
  automation: Array<{ type: string; status: string }>;
}

export interface LiveAssetState {
  campaigns: LiveCampaign[];
  campaignAssets: LiveCampaignAsset[];
  customerAssets: LiveCustomerAsset[];
  assets: LiveAsset[];
}

export const EMPTY_ASSET_STATE: LiveAssetState = {
  campaigns: [],
  campaignAssets: [],
  customerAssets: [],
  assets: [],
};

// ─── Content identity ────────────────────────────────────────────────────────

const t = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const url = (value: unknown): string => t(value).replace(/\/+$/, "");

interface Offering {
  header: string;
  description: string;
  amountMicros: string;
  currency: string;
  unit: string;
  finalUrl: string;
}

export const assetKey = {
  sitelink: (text: string, d1: string, d2: string, finalUrl: string) =>
    `SITELINK|${t(text)}|${t(d1)}|${t(d2)}|${url(finalUrl)}`,
  callout: (text: string) => `CALLOUT|${t(text)}`,
  snippet: (header: string, values: string[]) => `SNIPPET|${t(header)}|${values.map(t).join("¦")}`,
  price: (type: string, offerings: Offering[]) =>
    `PRICE|${t(type)}|${offerings
      .map((o) => [t(o.header), t(o.description), String(o.amountMicros), t(o.currency), t(o.unit), url(o.finalUrl)].join("~"))
      .join("¦")}`,
  text: (text: string) => `TEXT|${t(text)}`,
  imageById: (id: string) => `IMAGE#${id}`,
  imageByName: (name: string) => `IMAGE@${t(name)}`,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The content key of a Google asset row, as the planner would write it. */
function keyOfRaw(asset: Record<string, unknown>): string | null {
  const type = t(asset.type);
  const finalUrls = Array.isArray(asset.finalUrls) ? (asset.finalUrls as unknown[]) : [];
  const sitelink = isRecord(asset.sitelinkAsset) ? asset.sitelinkAsset : null;
  const callout = isRecord(asset.calloutAsset) ? asset.calloutAsset : null;
  const snippet = isRecord(asset.structuredSnippetAsset) ? asset.structuredSnippetAsset : null;
  const text = isRecord(asset.textAsset) ? asset.textAsset : null;
  const price = isRecord(asset.priceAsset) ? asset.priceAsset : null;
  if (type === "SITELINK" && sitelink)
    return assetKey.sitelink(t(sitelink.linkText), t(sitelink.description1), t(sitelink.description2), t(finalUrls[0]));
  if (type === "CALLOUT" && callout) return assetKey.callout(t(callout.calloutText));
  if (type === "STRUCTURED_SNIPPET" && snippet)
    return assetKey.snippet(t(snippet.header), (Array.isArray(snippet.values) ? snippet.values : []).map(t));
  if (type === "TEXT" && text) return assetKey.text(t(text.text));
  if (type === "PRICE" && price) {
    const offerings = (Array.isArray(price.priceOfferings) ? price.priceOfferings : []).map((raw) => {
      const o = isRecord(raw) ? raw : {};
      const money = isRecord(o.price) ? o.price : {};
      return {
        header: t(o.header),
        description: t(o.description),
        amountMicros: String(money.amountMicros ?? ""),
        currency: t(money.currencyCode),
        unit: t(o.unit),
        finalUrl: t(o.finalUrl),
      };
    });
    return assetKey.price(t(price.type), offerings);
  }
  if (type === "IMAGE") return assetKey.imageById(String(asset.id ?? ""));
  return null;
}

function liveAssetOf(raw: unknown): LiveAsset {
  const asset = isRecord(raw) ? raw : {};
  return {
    resourceName: t(asset.resourceName),
    id: String(asset.id ?? ""),
    type: t(asset.type),
    name: t(asset.name) || null,
    key: keyOfRaw(asset),
  };
}

/**
 * Raw searchStream rows (as `queryAssetState` returns them) → live state. Each
 * row names only the fields read from it, as `unknown`: every value is checked
 * before it is used, so any row type carrying those fields is accepted as is.
 */
export function mapAssetState(raw: {
  campaigns: Array<{ campaign?: unknown }>;
  campaignAssets: Array<{ campaignAsset?: unknown; campaign?: unknown; asset?: unknown }>;
  customerAssets: Array<{ customerAsset?: unknown; asset?: unknown }>;
  assets: Array<{ asset?: unknown }>;
}): LiveAssetState {
  return {
    campaigns: raw.campaigns.map((row) => {
      const c = isRecord(row.campaign) ? row.campaign : {};
      const settings = Array.isArray(c.assetAutomationSettings) ? c.assetAutomationSettings : [];
      return {
        resourceName: t(c.resourceName),
        name: t(c.name),
        automation: settings.map((s) => {
          const x = isRecord(s) ? s : {};
          return { type: t(x.assetAutomationType), status: t(x.assetAutomationStatus) };
        }),
      };
    }),
    campaignAssets: raw.campaignAssets.map((row) => {
      const link = isRecord(row.campaignAsset) ? row.campaignAsset : {};
      const campaign = isRecord(row.campaign) ? row.campaign : {};
      return {
        resourceName: t(link.resourceName),
        campaignResourceName: t(campaign.resourceName) || t(link.campaign),
        fieldType: t(link.fieldType),
        status: t(link.status),
        asset: liveAssetOf(row.asset),
      };
    }),
    customerAssets: raw.customerAssets.map((row) => {
      const link = isRecord(row.customerAsset) ? row.customerAsset : {};
      const asset = isRecord(row.asset) ? row.asset : {};
      return {
        resourceName: t(link.resourceName),
        assetId: String(asset.id ?? ""),
        fieldType: t(link.fieldType),
        status: t(link.status),
      };
    }),
    assets: raw.assets.map((row) => liveAssetOf(row.asset)),
  };
}

// ─── The plan ────────────────────────────────────────────────────────────────

/** Returns the base64 bytes of a blueprint image that is not in the account yet. */
export type ImageLoader = (imageKey: string) => string;

interface Wanted {
  fieldType: string;
  /** Matches a live link's asset. */
  matches: (asset: LiveAsset) => boolean;
  /** The asset's resource name, creating it in this mutate when it is new. */
  resource: () => string;
  describe: string;
}

export function planAssets(
  blueprint: Blueprint,
  live: LiveAssetState,
  loadImage: ImageLoader
): PlannedOperation[] {
  const customerId = blueprint.customerId;
  // A separate temporary-id range from the ad planner's, so both plans can
  // travel in one googleAds:mutate without colliding.
  let next = -100_000;
  const take = () => next--;

  const assetCreates: PlannedOperation[] = [];
  const links: PlannedOperation[] = [];
  const settings: PlannedOperation[] = [];

  const existingByKey = new Map<string, string>();
  for (const asset of live.assets) if (asset.key) existingByKey.set(asset.key, asset.resourceName);
  const planned = new Map<string, string>();

  const resolve = (key: string, body: () => Record<string, unknown>, describe: string): string => {
    const known = planned.get(key) ?? existingByKey.get(key);
    if (known) return known;
    const resourceName = `customers/${customerId}/assets/${take()}`;
    assetCreates.push({
      stage: STAGES.ASSETS,
      op: { assetOperation: { create: { resourceName, ...body() } } },
      temporaryId: resourceName,
      describe,
    });
    planned.set(key, resourceName);
    return resourceName;
  };

  const image = (imageKey: string): Pick<Wanted, "matches" | "resource"> => {
    const spec = blueprint.images[imageKey];
    if (spec.existingAssetId) {
      const id = spec.existingAssetId;
      return {
        matches: (asset) => asset.type === "IMAGE" && asset.id === id,
        resource: () => `customers/${customerId}/assets/${id}`,
      };
    }
    const byName = live.assets.find((a) => a.type === "IMAGE" && a.name === spec.name);
    return {
      matches: (asset) => asset.type === "IMAGE" && (asset.name === spec.name || (byName ? asset.id === byName.id : false)),
      resource: () =>
        byName?.resourceName ??
        resolve(
          assetKey.imageByName(spec.name),
          () => ({ name: spec.name, type: "IMAGE", imageAsset: { data: loadImage(imageKey) } }),
          `Upload image "${spec.name}" (approved by ${spec.approvedBy}, ${spec.approvedAt})`
        ),
    };
  };

  for (const campaign of blueprint.campaigns) {
    const assets = campaign.assets;
    if (!assets) continue;
    // A campaign created in this pass has no resource name yet; the apply's
    // second pass dresses it after the refresh.
    const liveCampaign = live.campaigns.find((c) => c.name === campaign.name);
    if (!liveCampaign) continue;

    const wanted: Wanted[] = [];
    const byKey = (fieldType: string, key: string, body: () => Record<string, unknown>, label: string) =>
      wanted.push({
        fieldType,
        matches: (asset) => asset.key === key,
        resource: () => resolve(key, body, label),
        describe: label,
      });

    for (const s of assets.sitelinks)
      byKey(
        "SITELINK",
        assetKey.sitelink(s.text, s.description1, s.description2, s.finalUrl),
        () => ({ finalUrls: [s.finalUrl], sitelinkAsset: { linkText: s.text, description1: s.description1, description2: s.description2 } }),
        `sitelink "${s.text}"`
      );
    for (const c of assets.callouts)
      byKey("CALLOUT", assetKey.callout(c.text), () => ({ calloutAsset: { calloutText: c.text } }), `callout "${c.text}"`);
    if (assets.snippet) {
      const { header, values } = assets.snippet;
      byKey("STRUCTURED_SNIPPET", assetKey.snippet(header, values), () => ({ structuredSnippetAsset: { header, values } }), `snippet "${header}"`);
    }
    if (assets.price) {
      const price = assets.price;
      const offerings: Offering[] = price.items.map((item) => ({
        header: item.header,
        description: item.description,
        amountMicros: String(Math.round(item.price * 1_000_000)),
        currency: price.currency,
        unit: price.unit,
        finalUrl: item.finalUrl,
      }));
      byKey(
        "PRICE",
        assetKey.price(price.type, offerings),
        () => ({
          priceAsset: {
            type: price.type,
            languageCode: "en",
            priceOfferings: offerings.map((o) => ({
              header: o.header,
              description: o.description,
              price: { currencyCode: o.currency, amountMicros: o.amountMicros },
              unit: o.unit,
              finalUrl: o.finalUrl,
            })),
          },
        }),
        `price tiers ${price.items.map((i) => `${i.header} ${price.currency} ${i.price}`).join(" / ")}`
      );
    }
    if (assets.businessName)
      byKey("BUSINESS_NAME", assetKey.text(assets.businessName), () => ({ textAsset: { text: assets.businessName } }), `business name "${assets.businessName}"`);
    if (assets.businessLogo)
      wanted.push({ fieldType: "BUSINESS_LOGO", ...image(assets.businessLogo), describe: `business logo ${assets.businessLogo}` });
    for (const key of assets.images)
      wanted.push({ fieldType: "AD_IMAGE", ...image(key), describe: `image ${key}` });

    for (const want of wanted) {
      const link = live.campaignAssets.find(
        (l) => l.campaignResourceName === liveCampaign.resourceName && l.fieldType === want.fieldType && want.matches(l.asset)
      );
      if (link?.status === "ENABLED") continue;
      if (link && link.status === "PAUSED") {
        links.push({
          stage: STAGES.ASSETS,
          op: { campaignAssetOperation: { update: { resourceName: link.resourceName, status: "ENABLED" }, updateMask: "status" } },
          describe: `${campaign.name}: re-enable ${want.describe}`,
        });
        continue;
      }
      links.push({
        stage: STAGES.ASSETS,
        op: { campaignAssetOperation: { create: { campaign: liveCampaign.resourceName, asset: want.resource(), fieldType: want.fieldType } } },
        describe: `${campaign.name}: attach ${want.describe}`,
      });
    }

    // Automation: Google may not write text or pick images on these campaigns.
    const desired = Object.entries(assets.automation ?? {});
    if (desired.length > 0) {
      const current = new Map(liveCampaign.automation.map((a) => [a.type, a.status]));
      if (desired.some(([type, status]) => current.get(type) !== status)) {
        const merged = new Map(current);
        for (const [type, status] of desired) merged.set(type, status);
        settings.push({
          stage: STAGES.ASSETS,
          op: {
            campaignOperation: {
              update: {
                resourceName: liveCampaign.resourceName,
                assetAutomationSettings: [...merged].map(([type, status]) => ({ assetAutomationType: type, assetAutomationStatus: status })),
              },
              updateMask: "asset_automation_settings",
            },
          },
          describe: `${campaign.name}: ${desired.map(([type, status]) => `${type} ${status}`).join(", ")}`,
        });
      }
    }
  }

  // Retired account-level assets: paused, never removed.
  for (const retired of blueprint.retire.customerAssets) {
    const link = live.customerAssets.find((c) => c.assetId === retired.assetId && c.fieldType === retired.fieldType);
    if (!link || link.status !== "ENABLED") continue;
    settings.push({
      stage: STAGES.ASSETS,
      op: { customerAssetOperation: { update: { resourceName: link.resourceName, status: "PAUSED" }, updateMask: "status" } },
      describe: `Pause account-level ${retired.fieldType.toLowerCase()} ${retired.assetId} — ${retired.reason}`,
    });
  }

  return [...assetCreates, ...links, ...settings];
}

export type { MutateOperation };
