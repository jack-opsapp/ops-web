export const ANALYTICS_PROPERTY_REGISTRY = {
  marketing: {
    propertyId: "475051117",
    measurementId: "G-HKM7RWVTDV",
  },
  web_app: {
    propertyId: "539494652",
    measurementId: "G-JJP5SN122V",
  },
  ios_app: {
    propertyId: "514229717",
    measurementId: null,
  },
} as const;

export type AnalyticsPropertyKey = keyof typeof ANALYTICS_PROPERTY_REGISTRY;
