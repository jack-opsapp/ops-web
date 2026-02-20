import {
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  sendPasswordResetEmail as firebaseSendPasswordReset,
  type User,
  type Unsubscribe,
} from "firebase/auth";
import { auth } from "./config";

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account",
});

/**
 * Sign in with Google via popup.
 * Returns the authenticated user.
 */
export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
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
 * Send a password reset email to the given address.
 */
export async function sendPasswordResetEmail(email: string): Promise<void> {
  await firebaseSendPasswordReset(auth, email);
}
