import { describe, expect, it } from "vitest";
import { getGoogleAnalyticsReaderCredentials } from "@/lib/analytics/google-service-account";

const FIREBASE_EMAIL =
  "firebase-adminsdk-fbsvc@ops-production.iam.gserviceaccount.com";
const FIREBASE_PRIVATE_KEY =
  "-----BEGIN PRIVATE KEY-----\nfirebase-reader-key\n-----END PRIVATE KEY-----\n";

describe("Google analytics reader credentials", () => {
  it("uses the existing Firebase service-account JSON when dedicated credentials are absent", () => {
    const credentials = getGoogleAnalyticsReaderCredentials({
      NODE_ENV: "test",
      FIREBASE_ADMIN_SERVICE_ACCOUNT: JSON.stringify({
        client_email: FIREBASE_EMAIL,
        private_key: FIREBASE_PRIVATE_KEY,
      }),
    });

    expect(credentials).toEqual({
      clientEmail: FIREBASE_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY,
      source: "FIREBASE_ADMIN_SERVICE_ACCOUNT",
    });
  });

  it("uses the existing explicit Firebase service-account pair when dedicated credentials are absent", () => {
    const credentials = getGoogleAnalyticsReaderCredentials({
      NODE_ENV: "test",
      FIREBASE_ADMIN_CLIENT_EMAIL: FIREBASE_EMAIL,
      FIREBASE_ADMIN_PRIVATE_KEY: FIREBASE_PRIVATE_KEY.replace(/\n/g, "\\n"),
    });

    expect(credentials).toEqual({
      clientEmail: FIREBASE_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY,
      source: "FIREBASE_ADMIN_CLIENT_EMAIL",
    });
  });

  it("names the dedicated env family that supplied credentials over the Firebase fallback", () => {
    const dedicatedEmail = "ops-analytics-reader@ops-ios-app.iam.gserviceaccount.com";

    expect(
      getGoogleAnalyticsReaderCredentials({
        NODE_ENV: "test",
        GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({
          client_email: dedicatedEmail,
          private_key: FIREBASE_PRIVATE_KEY,
        }),
        FIREBASE_ADMIN_CLIENT_EMAIL: FIREBASE_EMAIL,
        FIREBASE_ADMIN_PRIVATE_KEY: FIREBASE_PRIVATE_KEY,
      })
    ).toEqual({
      clientEmail: dedicatedEmail,
      privateKey: FIREBASE_PRIVATE_KEY,
      source: "GA4_SERVICE_ACCOUNT_JSON",
    });

    expect(
      getGoogleAnalyticsReaderCredentials({
        NODE_ENV: "test",
        SEARCH_CONSOLE_SERVICE_ACCOUNT_CLIENT_EMAIL: dedicatedEmail,
        SEARCH_CONSOLE_SERVICE_ACCOUNT_PRIVATE_KEY: FIREBASE_PRIVATE_KEY,
        FIREBASE_ADMIN_CLIENT_EMAIL: FIREBASE_EMAIL,
        FIREBASE_ADMIN_PRIVATE_KEY: FIREBASE_PRIVATE_KEY,
      })
    ).toEqual({
      clientEmail: dedicatedEmail,
      privateKey: FIREBASE_PRIVATE_KEY,
      source: "SEARCH_CONSOLE_SERVICE_ACCOUNT_CLIENT_EMAIL",
    });
  });
});
