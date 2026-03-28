import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  type Auth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Lazy initialization - prevents SSG/SSR crashes when env vars are missing
let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;

function getFirebaseApp(): FirebaseApp {
  if (!_app) {
    _app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  }
  return _app;
}

function getFirebaseAuth(): Auth {
  if (!_auth) {
    const app = getFirebaseApp();
    // If auth was already initialized by another import, use getAuth.
    // Otherwise, use initializeAuth with explicit persistence to avoid
    // Firebase v11's default IndexedDB persistence hanging silently.
    try {
      _auth = initializeAuth(app, {
        persistence: browserLocalPersistence,
        popupRedirectResolver: browserPopupRedirectResolver,
      });
    } catch {
      // initializeAuth throws if auth was already initialized — fall back
      _auth = getAuth(app);
    }
  }
  return _auth;
}

// Export getters (safe for SSG) and direct references (for client-side)
export { getFirebaseApp, getFirebaseAuth };

// For backward compatibility - these will throw if called during SSG
export const app = typeof window !== "undefined" ? getFirebaseApp() : (null as unknown as FirebaseApp);
export const auth = typeof window !== "undefined" ? getFirebaseAuth() : (null as unknown as Auth);
