export const ANALYTICS_PROPERTY_REGISTRY = {
  marketing: {
    propertyId: "475051117",
    measurementId: "G-HKM7RWVTDV",
    productionHosts: ["opsapp.co", "www.opsapp.co", "try.opsapp.co"],
  },
  web_app: {
    propertyId: "539494652",
    measurementId: "G-JJP5SN122V",
    productionHosts: ["app.opsapp.co"],
  },
  ios_app: {
    propertyId: "514229717",
    measurementId: null,
    productionHosts: null,
  },
} as const;

export type AnalyticsPropertyKey = keyof typeof ANALYTICS_PROPERTY_REGISTRY;
