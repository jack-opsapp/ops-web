/** Firebase receives only the five deliberate Google optimization events. */
import { getAnalytics, logEvent, type Analytics } from "firebase/analytics";
import { getFirebaseApp } from "@/lib/firebase/config";
import { analyticsService } from "./analytics-service";

const ANALYTICS_ENABLED = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === "true";

let instance: Analytics | null = null;

function getAnalyticsInstance(): Analytics | null {
  if (!ANALYTICS_ENABLED || typeof window === "undefined") return null;
  if (instance) return instance;
  try {
    instance = getAnalytics(getFirebaseApp());
    return instance;
  } catch {
    return null;
  }
}

function conversion(eventName: string, properties: Record<string, unknown> = {}) {
  const analytics = getAnalyticsInstance();
  if (analytics) logEvent(analytics, eventName, properties);
  analyticsService?.track("lifecycle", eventName, properties);
}

export function trackSignUp(method: "email" | "google" | "apple") {
  conversion("sign_up", { method });
}

export function trackBeginTrial() {
  conversion("begin_trial");
}

export function trackCompleteOnboarding() {
  conversion("complete_onboarding");
}

export function trackCreateFirstProject() {
  conversion("create_first_project");
}

export function trackPurchase(
  planName: string,
  price: number,
  currency = "USD"
) {
  conversion("purchase", { item_name: planName, price, currency });
}
