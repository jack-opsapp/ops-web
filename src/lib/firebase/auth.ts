import {
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  OAuthProvider,
  EmailAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  reauthenticateWithCredential,
  updatePassword as firebaseUpdatePassword,
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

// ─── Redirect Flag ──────────────────────────────────────────────────────────
// In Firebase v11, calling getRedirectResult() proactively blocks
// onAuthStateChanged from firing. We only call it when we know a
// redirect was initiated (flagged via sessionStorage).
const REDIRECT_FLAG_KEY = "ops-auth-redirect-pending";
const REDIRECT_CTX_KEY = "ops-auth-redirect-ctx";

export function setRedirectFlag() {
  try { sessionStorage.setItem(REDIRECT_FLAG_KEY, "1"); } catch {}
}

export function isRedirectPending(): boolean {
  try { return sessionStorage.getItem(REDIRECT_FLAG_KEY) === "1"; } catch { return false; }
}

export function clearRedirectFlag() {
  try { sessionStorage.removeItem(REDIRECT_FLAG_KEY); } catch {}
}

// ─── Redirect Context ───────────────────────────────────────────────────────
// When a page kicks off OAuth via signInWithGoogle/Apple, it stashes where the
// user came from (login/register/join), the provider, and any per-origin data
// (redirect target, invite code). After the user returns, the origin page reads
// this back via `consumeRedirectContext()` to run its post-auth logic (route
// decisions, analytics events, company-join API call, etc.).

export type RedirectContext = {
  origin: "login" | "register" | "join";
  provider: "google" | "apple";
  /** For login: where to route an already-onboarded user. */
  redirectTo?: string;
  /** For join: the invite code the user was responding to. */
  joinCode?: string;
};

function setRedirectContext(ctx: RedirectContext) {
  try { sessionStorage.setItem(REDIRECT_CTX_KEY, JSON.stringify(ctx)); } catch {}
}

/** Read the redirect context once and delete it. Returns null if none. */
export function consumeRedirectContext(): RedirectContext | null {
  try {
    const raw = sessionStorage.getItem(REDIRECT_CTX_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(REDIRECT_CTX_KEY);
    return JSON.parse(raw) as RedirectContext;
  } catch {
    return null;
  }
}

/**
 * Read the redirect context without clearing it. Use this when a page needs
 * to detect "we're in the post-OAuth-return window" before the origin-specific
 * effect consumes the context and navigates. SSR-safe (returns null when
 * sessionStorage is unavailable).
 */
export function peekRedirectContext(): RedirectContext | null {
  try {
    const raw = sessionStorage.getItem(REDIRECT_CTX_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RedirectContext;
  } catch {
    return null;
  }
}

/**
 * Discard any redirect context. Use when Firebase has conclusively resolved
 * the auth state to "no user" — at that point, any stashed context is stale
 * (abandoned OAuth, cancelled at provider, closed tab mid-flight).
 */
export function clearRedirectContext(): void {
  try { sessionStorage.removeItem(REDIRECT_CTX_KEY); } catch {}
}

/**
 * Sign in with Google.
 *
 * Production uses signInWithRedirect so the OAuth handoff lives on our
 * custom authDomain (auth.opsapp.co) — same eTLD+1 as the app, avoids the
 * Cross-Origin-Opener-Policy warnings signInWithPopup generates, and works
 * inside embedded-browser edge cases.
 *
 * Development falls back to signInWithPopup because localhost and
 * auth.opsapp.co do NOT share eTLD+1, so Chrome's third-party storage
 * partitioning silently eats the credential during the redirect return —
 * getRedirectResult resolves null and the sign-in never completes. Popup
 * bypasses the cross-origin handoff entirely (postMessage to the opener
 * instead of storage sharing). The COOP console warnings are noise-only.
 *
 * In redirect mode, the returned promise never resolves on success (the
 * browser navigates away). In popup mode, it resolves after the popup
 * closes; the subsequent onAuthStateChanged fire drives AuthProvider.
 */
export async function signInWithGoogle(ctx: RedirectContext): Promise<void> {
  setRedirectContext(ctx);
  if (process.env.NODE_ENV === "development") {
    try {
      const { signInWithPopup } = await import("firebase/auth");
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      clearRedirectContext();
      throw err;
    }
    return;
  }
  setRedirectFlag();
  await signInWithRedirect(auth, googleProvider);
}

/** Sign in with Apple. See `signInWithGoogle` for the dev/prod rationale. */
export async function signInWithApple(ctx: RedirectContext): Promise<void> {
  setRedirectContext(ctx);
  if (process.env.NODE_ENV === "development") {
    try {
      const { signInWithPopup } = await import("firebase/auth");
      await signInWithPopup(auth, appleProvider);
    } catch (err) {
      clearRedirectContext();
      throw err;
    }
    return;
  }
  setRedirectFlag();
  await signInWithRedirect(auth, appleProvider);
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

/**
 * Get the primary auth provider for the current user.
 * Returns "password" for email/password, "google.com" for Google,
 * "apple.com" for Apple, or null if no user is signed in.
 */
export function getAuthProvider(): string | null {
  const user = auth.currentUser;
  if (!user) return null;
  if (!user.providerData || user.providerData.length === 0) return null;
  return user.providerData[0].providerId;
}

/**
 * Check if the current user signed in with email/password.
 * Returns false for Google, Apple, or other SSO providers.
 */
export function isEmailPasswordUser(): boolean {
  return getAuthProvider() === "password";
}

/**
 * Change the password for the current email/password user.
 * Requires re-authentication with current password first.
 * Throws if the current password is wrong or the user is not an email/password user.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.email) {
    throw new Error("No authenticated user");
  }

  // Re-authenticate with current password to confirm identity
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);

  // Update to new password
  await firebaseUpdatePassword(user, newPassword);
}
