import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  type User,
  type Unsubscribe,
} from "firebase/auth";
import { auth } from "./config";

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account",
});

const appleProvider = new OAuthProvider("apple.com");
appleProvider.addScope("email");
appleProvider.addScope("name");

/**
 * Sign in with Google — tries popup first, falls back to redirect.
 * Popup can fail due to COOP policies or popup blockers on some browsers.
 */
export async function signInWithGoogle(): Promise<User> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (
      code === "auth/popup-blocked" ||
      code === "auth/popup-closed-by-user" ||
      code === "auth/network-request-failed" ||
      code === "auth/internal-error"
    ) {
      console.warn("[auth] Popup failed, falling back to redirect:", code);
      await signInWithRedirect(auth, googleProvider);
      // Page will reload — this promise never resolves
      return new Promise(() => {});
    }
    throw err;
  }
}

/**
 * Sign in with Apple — tries popup first, falls back to redirect.
 */
export async function signInWithApple(): Promise<User> {
  try {
    const result = await signInWithPopup(auth, appleProvider);
    return result.user;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (
      code === "auth/popup-blocked" ||
      code === "auth/popup-closed-by-user" ||
      code === "auth/network-request-failed" ||
      code === "auth/internal-error"
    ) {
      console.warn("[auth] Popup failed, falling back to redirect:", code);
      await signInWithRedirect(auth, appleProvider);
      return new Promise(() => {});
    }
    throw err;
  }
}

/**
 * Check for redirect result on page load.
 * Call this in AuthProvider to handle the redirect callback.
 */
export async function checkRedirectResult(): Promise<User | null> {
  try {
    const result = await getRedirectResult(auth);
    return result?.user ?? null;
  } catch (err) {
    console.warn("[auth] Redirect result check failed:", err);
    return null;
  }
}

/**
 * Sign in with email and password.
 * Returns the authenticated user.
 */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<User> {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

/**
 * Create a new account with email and password.
 * Returns the authenticated user.
 */
export async function signUpWithEmail(
  email: string,
  password: string
): Promise<User> {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  return result.user;
}

/**
 * Sign the current user out.
 */
export async function signOut(): Promise<void> {
  await firebaseSignOut(auth);
}

/**
 * Subscribe to auth state changes.
 * Returns an unsubscribe function.
 */
export function onAuthStateChanged(
  callback: (user: User | null) => void
): Unsubscribe {
  return firebaseOnAuthStateChanged(auth, callback);
}

/**
 * Get the currently authenticated user, or null if not signed in.
 */
export function getCurrentUser(): User | null {
  return auth.currentUser;
}

/**
 * Get the ID token for the current user.
 * Optionally force-refresh the token.
 */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}
