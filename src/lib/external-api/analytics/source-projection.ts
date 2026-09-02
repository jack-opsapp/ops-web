import {
  sourceAttributionSchema,
  type SourceAttribution,
} from "../contracts/lead-feed";

const attributionKeys = [
  "source",
  "medium",
  "campaign",
  "term",
  "content",
] as const;

type PublicDimension = Readonly<{
  present: boolean;
  handle: string | null;
  label: string | null;
}>;

type PublicPage = Readonly<{
  host: string;
  pathHandle: string;
  routeLabel: string | null;
}>;

type InquiryTimeQuality = "exact" | "provider" | "manual" | "fallback";

type ExternalIntakeSource = Readonly<{
  sourceId: string;
  sourceLabel: string | null;
  siteHost: string;
  siteLabel: string | null;
  formId: string;
  formLabel: string | null;
  sourceChannel:
    | "website"
    | "email"
    | "referral"
    | "phone"
    | "social"
    | "walk_in"
    | "repeat_business"
    | "manual"
    | "other";
  campaign?: PublicDimension;
  utm?: Partial<Record<(typeof attributionKeys)[number], PublicDimension>>;
  click?: Readonly<{
    providerCode: "google_ads" | "microsoft_ads" | "meta_ads" | "other" | null;
    captured: boolean;
  }>;
  landingPage?: PublicPage | null;
  referrer?: PublicPage | null;
}>;

const sourceMapping: Readonly<
  Record<
    string,
    Readonly<{
      channel: SourceAttribution["sourceChannel"];
      integration: SourceAttribution["sourceIntegrationType"];
    }>
  >
> = {
  email: { channel: "email", integration: "email_import" },
  referral: { channel: "referral", integration: "referral" },
  phone: { channel: "phone", integration: "phone" },
  walk_in: { channel: "walk_in", integration: "walk_in" },
  social_media: { channel: "social", integration: "social" },
  repeat_client: {
    channel: "repeat_business",
    integration: "repeat_business",
  },
  voice_log: { channel: "manual", integration: "manual" },
  manual: { channel: "manual", integration: "manual" },
  website: { channel: "website", integration: "other" },
};

const timingMapping: Readonly<
  Record<
    InquiryTimeQuality,
    Readonly<{
      source: SourceAttribution["timingSource"];
      quality: SourceAttribution["timingQuality"];
    }>
  >
> = {
  exact: { source: "authenticated_request", quality: "exact" },
  provider: {
    source: "provider_message",
    quality: "provider_derived",
  },
  manual: { source: "manual", quality: "manual" },
  fallback: { source: "creation_fallback", quality: "fallback" },
};

function minute(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("invalid external lead source timestamp");
  }
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

function absentDimension(): PublicDimension {
  return { present: false, handle: null, label: null };
}

function dimension(value: PublicDimension | undefined): PublicDimension {
  return value ?? absentDimension();
}

export function buildExternalLeadSourceProjection(
  input: Readonly<{
    opportunitySource: string | null;
    timing: Readonly<{
      inquiryReceivedAt: string;
      leadCreatedAt: string;
      attributionCapturedAt: string;
      inquiryTimeQuality: InquiryTimeQuality;
    }>;
    externalIntake?: ExternalIntakeSource;
  }>
): SourceAttribution {
  const mapped =
    (input.opportunitySource && sourceMapping[input.opportunitySource]) ||
    ({ channel: "other", integration: "other" } as const);
  const intake = input.externalIntake;
  const sourceChannel = intake?.sourceChannel ?? mapped.channel;
  const sourceIntegrationType = intake
    ? ("external_intake" as const)
    : mapped.integration;
  const timing = timingMapping[input.timing.inquiryTimeQuality];
  const utm = Object.fromEntries(
    attributionKeys.map((key) => [key, dimension(intake?.utm?.[key])])
  );

  return sourceAttributionSchema.parse({
    sourceChannel,
    sourceIntegrationType,
    sourceId: intake?.sourceId ?? null,
    sourceLabel: intake?.sourceLabel ?? null,
    siteHost: intake?.siteHost.toLowerCase() ?? null,
    siteLabel: intake?.siteLabel ?? null,
    formId: intake?.formId ?? null,
    formLabel: intake?.formLabel ?? null,
    campaign: dimension(intake?.campaign),
    utm,
    click: intake?.click ?? { providerCode: null, captured: false },
    landingPage: intake?.landingPage ?? null,
    referrer: intake?.referrer ?? null,
    inquiryReceivedAt: minute(input.timing.inquiryReceivedAt),
    leadCreatedAt: minute(input.timing.leadCreatedAt),
    attributionCapturedAt: minute(input.timing.attributionCapturedAt),
    timingSource: timing.source,
    timingQuality: timing.quality,
    completeness: {
      channelKnown: sourceChannel !== "other",
      authenticatedSite: intake !== undefined,
      configuredForm: intake !== undefined,
      campaignObserved: Boolean(intake?.campaign?.present),
      utmSetObserved: attributionKeys.some(
        (key) => intake?.utm?.[key]?.present === true
      ),
      landingPageObserved: intake?.landingPage != null,
      referrerObserved: intake?.referrer != null,
    },
  });
}
