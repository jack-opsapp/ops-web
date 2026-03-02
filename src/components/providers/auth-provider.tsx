"use client";

import { useEffect, useRef } from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { onAuthStateChanged, getIdToken, checkRedirectResult, clearRedirectFlag, isRedirectPending } from "@/lib/firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/config";
import { UserService } from "@/lib/api/services/user-service";
import { toast } from "sonner";

/**
 * Set a cookie so the Next.js middleware can check auth status server-side.
 * Firebase auth is client-side only (localStorage), but middleware runs
 * on the server and can only read cookies.
 */
function setAuthCookie(token: string | null) {
  if (typeof document === "undefined") return;
  if (token) {
    document.cookie = `ops-auth-token=${token}; path=/; max-age=2592000; SameSite=Lax`;
  } else {
    document.cookie = "ops-auth-token=; path=/; max-age=0";
  }
}

/**
 * AuthProvider determines auth state and syncs it to Zustand.
 *
 * Uses authStateReady() as the primary mechanism (Promise-based,
 * resolves when Firebase has determined auth state). Falls back to
 * onAuthStateChanged for reactive updates (sign-in, sign-out, token refresh).
 *
 * Important: The LoginPage handles the initial syncUser call during
 * a fresh sign-in. AuthProvider only calls syncUser when Firebase
 * detects an existing session on page reload (no user in Zustand store yet).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const setFirebaseAuth = useAuthStore((s) => s.setFirebaseAuth);
  const setUser = useAuthStore((s) => s.setUser);
  const setCompany = useAuthStore((s) => s.setCompany);
  const setLoading = useAuthStore((s) => s.setLoading);
  const fetchPermissions = usePermissionStore((s) => s.fetchPermissions);
  const clearPermissions = usePermissionStore((s) => s.clear);
  const fetchingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // Handle redirect result only if a redirect was actually initiated
    if (isRedirectPending()) {
      console.log("[AuthProvider] Redirect pending, checking result...");
      clearRedirectFlag();
      checkRedirectResult().then((redirectUser) => {
        if (redirectUser) {
          console.log("[AuthProvider] Redirect sign-in detected:", redirectUser.email);
        }
      });
    }

    /**
     * Process a Firebase user (or null) into Zustand state.
     * Called from both authStateReady and onAuthStateChanged.
     */
    async function handleAuthState(firebaseUser: import("firebase/auth").User | null) {
      if (cancelled) return;

      const authenticated = !!firebaseUser;
      setFirebaseAuth(authenticated);

      if (!authenticated) {
        setAuthCookie(null);
        clearPermissions();
        console.log("[AuthProvider] Not authenticated");
        setLoading(false);
        return;
      }

      // Get ID token for the cookie (middleware/server needs it)
      const idToken = await getIdToken();
      setAuthCookie(idToken);

      if (firebaseUser && !fetchingRef.current) {
        // Check if the login page already handled this (user already in store)
        const existingUser = useAuthStore.getState().currentUser;
        if (existingUser?.companyId) {
          console.log("[AuthProvider] User already in store, skipping sync.", existingUser.id);
          // Still load permissions if not initialized
          const permState = usePermissionStore.getState();
          if (!permState.initialized) {
            fetchPermissions(existingUser.id).catch((err) =>
              console.error("[AuthProvider] Failed to fetch permissions:", err)
            );
          }
          setLoading(false);
          return;
        }

        fetchingRef.current = true;
        console.log("[AuthProvider] Syncing user:", firebaseUser.email);
        try {
          if (!idToken || !firebaseUser.email) {
            console.warn("[AuthProvider] Missing idToken or email, aborting");
            fetchingRef.current = false;
            setLoading(false);
            return;
          }

          const result = await UserService.syncUser(
            idToken,
            firebaseUser.email,
            firebaseUser.displayName || undefined,
            firebaseUser.displayName?.split(" ")[0] || undefined,
            firebaseUser.displayName?.split(" ").slice(1).join(" ") || undefined,
            firebaseUser.photoURL || undefined
          );

          if (cancelled) return;

          console.log("[AuthProvider] syncUser result:", {
            userId: result.user.id,
            userRole: result.user.role,
            companyName: result.company?.name ?? "null",
          });

          setUser(result.user);
          if (result.company) {
            setCompany(result.company);
          } else {
            console.warn("[AuthProvider] NO COMPANY returned - hooks will be disabled!");
          }

          // Fetch permissions for the authenticated user
          fetchPermissions(result.user.id).catch((err) =>
            console.error("[AuthProvider] Failed to fetch permissions:", err)
          );
        } catch (err) {
          console.error("[AuthProvider] syncUser FAILED:", err);
          toast.error("Failed to load user data", {
            description: "Please try signing out and back in.",
          });
        } finally {
          fetchingRef.current = false;
          if (!cancelled) setLoading(false);
        }
      } else if (fetchingRef.current) {
        console.log("[AuthProvider] Already fetching, skipping");
      }
    }

    // ── Primary: authStateReady() ───────────────────────────────────────────
    // Resolves when Firebase has determined auth state. Unlike
    // onAuthStateChanged, this doesn't block on redirect resolution.
    const firebaseAuth = getFirebaseAuth();
    let initialCheckDone = false;

    console.log("[AuthProvider] Calling authStateReady()...");
    firebaseAuth.authStateReady().then(() => {
      if (cancelled || initialCheckDone) return;
      initialCheckDone = true;
      console.log("[AuthProvider] authStateReady resolved, currentUser:", !!firebaseAuth.currentUser);
      handleAuthState(firebaseAuth.currentUser);
    }).catch((err) => {
      console.error("[AuthProvider] authStateReady failed:", err);
      if (!cancelled && !initialCheckDone) {
        initialCheckDone = true;
        setFirebaseAuth(false);
        setLoading(false);
      }
    });

    // ── Secondary: onAuthStateChanged for reactive updates ──────────────────
    // Handles sign-in, sign-out, and token refresh AFTER the initial check.
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = onAuthStateChanged((firebaseUser) => {
        console.log("[AuthProvider] onAuthStateChanged fired:", !!firebaseUser);
        if (!initialCheckDone) {
          // First fire — use this as the initial check
          initialCheckDone = true;
          handleAuthState(firebaseUser);
        } else {
          // Subsequent fires — handle state changes (sign-out, token refresh)
          handleAuthState(firebaseUser);
        }
      });
    } catch (err) {
      console.error("[AuthProvider] Firebase init error:", err);
      if (!initialCheckDone) {
        initialCheckDone = true;
        setLoading(false);
      }
    }

    // ── Fallback: hard timeout ──────────────────────────────────────────────
    const timeout = setTimeout(() => {
      if (!initialCheckDone) {
        console.warn("[AuthProvider] Auth timed out after 3s — forcing unauthenticated");
        initialCheckDone = true;
        setFirebaseAuth(false);
        setLoading(false);
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      if (unsubscribe) unsubscribe();
    };
  }, [setFirebaseAuth, setUser, setCompany, setLoading, fetchPermissions, clearPermissions]);

  return <>{children}</>;
}
