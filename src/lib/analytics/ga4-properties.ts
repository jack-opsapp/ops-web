import {
  ANALYTICS_PROPERTY_REGISTRY,
  type AnalyticsPropertyKey,
} from "./property-registry";

export type GA4PropertyKey = AnalyticsPropertyKey;

const PROPERTY_ENV_BY_KEY: Record<GA4PropertyKey, string> = {
  marketing: "GA4_MARKETING_PROPERTY_ID",
  web_app: "GA4_WEB_APP_PROPERTY_ID",
  ios_app: "GA4_IOS_PROPERTY_ID",
};

export function getGA4PropertyId(
  key: GA4PropertyKey,
  environment: NodeJS.ProcessEnv = process.env
): string {
  const environmentKey = PROPERTY_ENV_BY_KEY[key];
  const value = environment[environmentKey];
  if (!value) throw new Error(`Missing ${environmentKey} env var`);
  if (value !== value.trim() || !/^\d+$/.test(value)) {
    throw new Error(`Invalid ${environmentKey} env var`);
  }
  if (value !== ANALYTICS_PROPERTY_REGISTRY[key].propertyId) {
    throw new Error(`${environmentKey} does not match the OPS property registry`);
  }
  return `properties/${value}`;
}

export function isGA4PropertyConfigured(
  key: GA4PropertyKey,
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  const environmentKey = PROPERTY_ENV_BY_KEY[key];
  if (!environment[environmentKey]) return false;
  getGA4PropertyId(key, environment);
  return true;
}

export function getGA4PropertyEnvironmentKey(key: GA4PropertyKey): string {
  return PROPERTY_ENV_BY_KEY[key];
}
