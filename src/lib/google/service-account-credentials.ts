/**
 * Google service-account credentials shared by every Google API client in
 * OPS-Web (Google Ads, Data Manager, GA4). One loader, one set of env vars,
 * so a credential rotation is a single change.
 *
 * SERVER ONLY. Never import from client components.
 *
 * Accepted shapes, in order:
 *   1. FIREBASE_ADMIN_SERVICE_ACCOUNT — the full service-account JSON.
 *   2. FIREBASE_ADMIN_PRIVATE_KEY (+ NEXT_PUBLIC_FIREBASE_PROJECT_ID, and
 *      optionally FIREBASE_ADMIN_CLIENT_EMAIL) — the key alone, in PEM, with
 *      literal "\n" escapes, or as a raw base64 body.
 */
import { parsePrivateKey } from "@/lib/firebase/parse-private-key";

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  [key: string]: unknown;
}

export function getServiceAccountCredentials(): ServiceAccountCredentials {
  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    return JSON.parse(serviceAccountJson) as ServiceAccountCredentials;
  }

  const privateKey = parsePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY);
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail =
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL ??
    `firebase-adminsdk-fbsvc@${projectId}.iam.gserviceaccount.com`;

  if (!privateKey || !projectId) {
    throw new Error("Missing FIREBASE_ADMIN_PRIVATE_KEY or NEXT_PUBLIC_FIREBASE_PROJECT_ID env var");
  }

  return { client_email: clientEmail, private_key: privateKey };
}

/** True when either credential shape is present (no validation of the key). */
export function hasServiceAccountCredentials(): boolean {
  return !!(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT || process.env.FIREBASE_ADMIN_PRIVATE_KEY);
}
