import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

import { normalizeCanonicalText } from "./canonicalize";
import {
  deriveDomainSeparatedHmac,
  parseRetainedHmacKeyRing,
  type VersionedHmacKeyRing,
} from "./idempotency";

export type AttributionDimension =
  | "campaign"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "utm_term"
  | "utm_content"
  | "landing_path"
  | "referrer_path";

export interface AttributionLookupIdentity {
  companyId: string;
  sourceId: string;
  dimension: AttributionDimension;
  rawValue: string;
}

export interface AttributionLookupDigest {
  kid: number;
  digest: string;
  writeEligible: boolean;
}

export interface ExistingAttributionLookup {
  publicHandle: string;
  lookupKeyVersion: number;
  lookupDigest: string;
  approvedLabel: string | null;
  labelApproved: boolean;
}

function activeFirstKids(keyRing: VersionedHmacKeyRing): number[] {
  if (!keyRing.keys.has(keyRing.activeKid)) {
    throw new Error("attribution HMAC active key is unavailable");
  }
  return [
    keyRing.activeKid,
    ...[...keyRing.keys.keys()]
      .filter((kid) => kid !== keyRing.activeKid)
      .sort((left, right) => right - left),
  ];
}

export function readAttributionHmacKeyRing(): VersionedHmacKeyRing {
  return parseRetainedHmacKeyRing(
    process.env.EXTERNAL_API_ATTRIBUTION_HMAC_KEYS,
    "EXTERNAL_API_ATTRIBUTION_HMAC_KEYS"
  );
}

export function deriveAttributionLookupCandidates(
  identity: AttributionLookupIdentity,
  keyRing: VersionedHmacKeyRing
): AttributionLookupDigest[] {
  const normalizedRawValue = normalizeCanonicalText(
    identity.rawValue
  ).toLocaleLowerCase("en-US");
  return activeFirstKids(keyRing).map((kid) => {
    const key = keyRing.keys.get(kid);
    if (!key) throw new Error("attribution HMAC key is unavailable");
    return Object.freeze({
      kid,
      digest: deriveDomainSeparatedHmac(
        key,
        "ops.external-api.attribution-lookup.v1",
        [
          identity.companyId,
          identity.sourceId,
          identity.dimension,
          normalizedRawValue,
        ]
      ),
      writeEligible: kid === keyRing.activeKid,
    });
  });
}

function digestMatches(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function handlePrefix(dimension: AttributionDimension): string {
  if (dimension === "campaign") return "cmp";
  if (dimension.endsWith("_path")) return "path";
  return "attr";
}

function safeApprovedLabel(entry: ExistingAttributionLookup): string | null {
  if (!entry.labelApproved || entry.approvedLabel === null) return null;
  const label = entry.approvedLabel.trim();
  return label.length >= 1 &&
    label.length <= 120 &&
    !/[\u0000-\u001f\u007f]/.test(label)
    ? label
    : null;
}

export function resolveAttributionDictionaryEntry(
  input: AttributionLookupIdentity & {
    existing: readonly ExistingAttributionLookup[];
  },
  keyRing: VersionedHmacKeyRing,
  random: (size: number) => Buffer = randomBytes
) {
  const candidates = deriveAttributionLookupCandidates(input, keyRing);
  const activeLookup = candidates.find((candidate) => candidate.writeEligible);
  if (!activeLookup) {
    throw new Error("attribution HMAC active lookup is unavailable");
  }

  for (const candidate of candidates) {
    const matched = input.existing.find(
      (entry) =>
        entry.lookupKeyVersion === candidate.kid &&
        digestMatches(entry.lookupDigest, candidate.digest)
    );
    if (matched) {
      return Object.freeze({
        publicHandle: matched.publicHandle,
        created: false,
        matchedLookupKeyVersion: candidate.kid,
        activeLookup,
        approvedLabel: safeApprovedLabel(matched),
        rekeyRequired: candidate.kid !== keyRing.activeKid,
      });
    }
  }

  const material = random(18);
  if (material.byteLength !== 18) {
    throw new Error("attribution handle entropy source is invalid");
  }
  return Object.freeze({
    publicHandle: `${handlePrefix(input.dimension)}_${material.toString(
      "base64url"
    )}`,
    created: true,
    matchedLookupKeyVersion: null,
    activeLookup,
    approvedLabel: null,
    rekeyRequired: false,
  });
}

type PublicDimension = {
  present: boolean;
  publicHandle: string | null;
  approvedLabel: string | null;
};

type PublicPage = {
  host: string;
  publicHandle: string;
  approvedLabel: string | null;
};

const attributionKeys = [
  "source",
  "medium",
  "campaign",
  "term",
  "content",
] as const;

function absentDimension() {
  return Object.freeze({
    present: false,
    handle: null,
    label: null,
  });
}

function publicDimension(value: PublicDimension | undefined) {
  if (!value?.present) return absentDimension();
  if (!value.publicHandle) {
    throw new Error("observed attribution requires an opaque handle");
  }
  return Object.freeze({
    present: true,
    handle: value.publicHandle,
    label: value.approvedLabel,
  });
}

export function buildSourceAttribution(input: {
  clickProviderCode?: "google_ads" | "microsoft_ads" | "meta_ads" | "other";
  clickId?: string;
  campaign?: PublicDimension;
  utm?: Partial<Record<(typeof attributionKeys)[number], PublicDimension>>;
  landingPage?: PublicPage;
  referrer?: PublicPage;
}) {
  const utm = Object.fromEntries(
    attributionKeys.map((key) => [key, publicDimension(input.utm?.[key])])
  ) as Record<
    (typeof attributionKeys)[number],
    ReturnType<typeof publicDimension>
  >;

  return Object.freeze({
    campaign: publicDimension(input.campaign),
    utm: Object.freeze(utm),
    click: Object.freeze({
      providerCode: input.clickProviderCode ?? null,
      captured: input.clickId !== undefined,
    }),
    landingPage: input.landingPage
      ? Object.freeze({
          host: input.landingPage.host.toLowerCase(),
          pathHandle: input.landingPage.publicHandle,
          routeLabel: input.landingPage.approvedLabel,
        })
      : null,
    referrer: input.referrer
      ? Object.freeze({
          host: input.referrer.host.toLowerCase(),
          pathHandle: input.referrer.publicHandle,
          routeLabel: input.referrer.approvedLabel,
        })
      : null,
  });
}
