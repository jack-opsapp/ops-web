import { Children, isValidElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGoogleAnalyticsConfigScript,
  getConfiguredMeasurementId,
  parseMeasurementId,
} from "@/lib/analytics/ga-config";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("GoogleAnalytics", () => {
  it("trims the configured measurement ID before building either GA script", async () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-TEST123\n");

    const { default: GoogleAnalytics } = await import(
      "@/components/layout/GoogleAnalytics"
    );
    const output = GoogleAnalytics();

    expect(isValidElement(output)).toBe(true);
    const scripts = Children.toArray(
      (output as ReactElement<{ children: React.ReactNode }>).props.children
    ) as ReactElement<{ src?: string; children?: string }>[];

    expect(scripts[0]?.props.src).toBe(
      "https://www.googletagmanager.com/gtag/js?id=G-TEST123"
    );
    expect(scripts[1]?.props.children).toContain(
      `gtag('config', "G-TEST123", {`
    );
    expect(scripts[1]?.props.children).toContain(
      "page_location: window.location.origin + analyticsPath"
    );
    expect(scripts[1]?.props.children).not.toContain("G-TEST123\n");
  });
});

describe("GA measurement ID parsing", () => {
  it("accepts a trimmed GA4 measurement ID", () => {
    expect(parseMeasurementId("  G-JJP5SN122V\n")).toBe("G-JJP5SN122V");
  });

  it("rejects missing and executable measurement ID text", () => {
    expect(parseMeasurementId(undefined)).toBeNull();
    expect(parseMeasurementId("")).toBeNull();
    expect(parseMeasurementId(`G-ABC');alert(1);//`)).toBeNull();
    expect(parseMeasurementId("UA-12345")).toBeNull();
  });

  it("serializes the measurement ID instead of interpolating executable text", () => {
    const script = buildGoogleAnalyticsConfigScript("G-TEST123");
    expect(script).toContain(`gtag('consent', 'default', {`);
    expect(script).toContain(`'ad_storage': 'denied'`);
    expect(script).toContain(`'ad_user_data': 'denied'`);
    expect(script).toContain(`'ad_personalization': 'denied'`);
    expect(script).toContain(`gtag('config', "G-TEST123", {`);
    expect(script).toContain(
      "page_location: window.location.origin + analyticsPath"
    );
    expect(script).not.toMatch(/window\.location\.(?:href|search)/);
  });

  it("templates resource identifiers before the initial logged-in page view", () => {
    const dataLayer: IArguments[] = [];
    const browser = {
      dataLayer,
      location: {
        origin: "https://app.opsapp.co",
        pathname:
          "/projects/01890f3b-57d2-8a11-9c7f-426614174000/tasks/42",
        search: "?client=private",
      },
    };
    Object.assign(globalThis, { dataLayer });

    try {
      new Function("window", buildGoogleAnalyticsConfigScript("G-TEST123"))(
        browser
      );
      const configCall = Array.from(dataLayer[2] ?? []);
      expect(configCall).toEqual([
        "config",
        "G-TEST123",
        {
          page_location:
            "https://app.opsapp.co/projects/:id/tasks/:id",
          page_path: "/projects/:id/tasks/:id",
        },
      ]);
    } finally {
      Reflect.deleteProperty(globalThis, "dataLayer");
    }
  });

  it("fails production configuration when a non-empty measurement ID is invalid", () => {
    expect(() =>
      getConfiguredMeasurementId("G-INVALID VALUE", "production")
    ).toThrow("Invalid NEXT_PUBLIC_GA_MEASUREMENT_ID");
    expect(getConfiguredMeasurementId(undefined, "production")).toBeNull();
    expect(
      getConfiguredMeasurementId("G-INVALID VALUE", "development")
    ).toBeNull();
  });
});
