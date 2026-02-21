/**
 * OPS Admin — Firebase Admin SDK
 *
 * SERVER ONLY. Never import from client components.
 * Used to query Firebase Auth user records (last sign-in, creation time, etc.)
 */
import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

let _app: App | null = null;

function getAdminApp(): App {
  if (_app) return _app;

  const existing = getApps();
  if (existing.length > 0) {
    _app = existing[0];
    return _app;
  }

  // Support full JSON or individual env vars
  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    _app = initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) });
    return _app;
  }

  // Construct from individual env vars (Vercel convention)
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
    ?? `firebase-adminsdk-fbsvc@${projectId}.iam.gserviceaccount.com`;

  if (!privateKey || !projectId) {
    throw new Error("Missing FIREBASE_ADMIN_PRIVATE_KEY or NEXT_PUBLIC_FIREBASE_PROJECT_ID env var");
  }

  _app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return _app;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

/**
 * Fetch all Firebase Auth users with pagination.
 * Returns flat list of UserRecord objects.
 */
export async function listAllAuthUsers() {
  const auth = getAdminAuth();
  const users: Awaited<ReturnType<Auth["listUsers"]>>["users"] = [];
  let pageToken: string | undefined;

  do {
    const result = await auth.listUsers(1000, pageToken);
    users.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);

  return users;
}

/**
 * Calculate DAU / WAU / MAU from a list of Auth user records.
 */
export function calcActiveUsers(users: Awaited<ReturnType<typeof listAllAuthUsers>>) {
  const now = Date.now();
  const DAY = 86_400_000;

  return {
    dau: users.filter(
      (u) => u.metadata.lastSignInTime &&
        now - new Date(u.metadata.lastSignInTime).getTime() < DAY
    ).length,
    wau: users.filter(
      (u) => u.metadata.lastSignInTime &&
        now - new Date(u.metadata.lastSignInTime).getTime() < 7 * DAY
    ).length,
    mau: users.filter(
      (u) => u.metadata.lastSignInTime &&
        now - new Date(u.metadata.lastSignInTime).getTime() < 30 * DAY
    ).length,
  };
}
