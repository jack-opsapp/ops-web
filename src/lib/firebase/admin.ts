/**
 * OPS Web - Firebase Admin SDK (singleton)
 *
 * Uses FIREBASE_ADMIN_* env vars (client_email, private_key, project_id)
 * to initialize the Admin SDK for server-side user management.
 *
 * NEVER import this from client-side code.
 */

import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

let adminApp: App | null = null;

function getAdminApp(): App {
  if (adminApp) return adminApp;

  const existing = getApps();
  if (existing.length > 0) {
    adminApp = existing[0];
    return adminApp;
  }

  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;

  if (!clientEmail || !privateKey || !projectId) {
    throw new Error(
      "Missing FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY, or FIREBASE_ADMIN_PROJECT_ID"
    );
  }

  adminApp = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      // Private key comes with escaped newlines from env var
      privateKey: privateKey.replace(/\\n/g, "\n"),
    }),
  });

  return adminApp;
}

/**
 * Returns the Firebase Admin Auth instance.
 * Lazily initializes the Admin SDK on first call.
 */
export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}
