"use client";

/**
 * GoogleAnalytics — Loads the GA4 gtag.js snippet when
 * NEXT_PUBLIC_GA_MEASUREMENT_ID is set in the environment.
 *
 * Scope: visit + traffic tracking only. Product analytics (feature
 * adoption, funnels, retention) still go to Supabase analytics_events
 * via src/lib/analytics/analytics-service.ts. Google Ads conversion
 * attribution still goes through Firebase Analytics. See
 * ops-software-bible/21_ANALYTICS_SYSTEM.md for the three-system layout.
 *
 * Privacy note: this is a logged-in product. Page URLs can contain
 * resource UUIDs (project IDs, client IDs) which are not direct PII
 * but should not be retained indefinitely. anonymize_ip is GA4-default.
 * Configure query-param exclusion + IP anonymization in the GA4 admin
 * for the OPS-Web data stream — do not encode property-level config here.
 */

import Script from "next/script";

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export default function GoogleAnalytics() {
  if (!GA_ID) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}');
        `}
      </Script>
    </>
  );
}
