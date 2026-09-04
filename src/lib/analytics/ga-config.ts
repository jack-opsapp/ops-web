export function parseMeasurementId(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && /^G-[A-Z0-9]+$/.test(trimmed) ? trimmed : null;
}

export function getConfiguredMeasurementId(
  value: string | undefined,
  environment: string | undefined
): string | null {
  const measurementId = parseMeasurementId(value);
  if (environment === "production" && value?.length && !measurementId) {
    throw new Error("Invalid NEXT_PUBLIC_GA_MEASUREMENT_ID");
  }
  return measurementId;
}

function normalizeAllowedHostnames(hostnames: readonly string[]): string[] {
  const normalized = [...new Set(
    hostnames.map((hostname) => hostname.trim().toLowerCase().replace(/\.$/, ""))
  )].filter(Boolean);

  if (
    normalized.length === 0 ||
    normalized.some(
      (hostname) =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
          hostname
        )
    )
  ) {
    throw new Error("Invalid Google Analytics production hostname allowlist");
  }

  return normalized;
}

export function buildGoogleAnalyticsConfigScript(
  measurementId: string,
  allowedHostnames: readonly string[]
): string {
  const productionHostnames = normalizeAllowedHostnames(allowedHostnames);
  return `
          (() => {
          const allowedHostnames = ${JSON.stringify(productionHostnames)};
          const analyticsHostname = window.location.hostname
            .toLowerCase()
            .replace(/\\.$/, '');
          if (!allowedHostnames.includes(analyticsHostname)) return;
          window.dataLayer = window.dataLayer || [];
          function gtag(){window.dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('consent', 'default', {
            'ad_storage': 'denied',
            'ad_user_data': 'denied',
            'ad_personalization': 'denied',
            'analytics_storage': 'granted'
          });
          const analyticsPath = window.location.pathname.replace(
            /\\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\\/|$)/gi,
            '/:id'
          ).replace(/\\/\\d+(?=\\/|$)/g, '/:id');
          gtag('config', ${JSON.stringify(measurementId)}, {
            page_location: window.location.origin + analyticsPath,
            page_path: analyticsPath
          });
          })();
        `;
}
