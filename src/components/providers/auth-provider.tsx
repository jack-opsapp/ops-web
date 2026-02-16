"use client";

import { useEffect, useRef } from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import { onAuthStateChanged, getIdToken } from "@/lib/firebase/auth";
import { UserService } from "@/lib/api/services/user-service";

/**
 * Set a cookie so the Next.js middleware can check auth status server-side.
 * Firebase auth is client-side only (localStorage), but middleware runs
 * on the server and can only read cookies.
 */
function setAuthCookie(authenticated: boolean) {
  if (typeof document === "undefined") return;
  if (authenticated) {
    document.cookie = "ops-auth-token=1; path=/; max-age=2592000; SameSite=Lax";
  } else {
    document.cookie = "ops-auth-token=; path=/; max-age=0";
  }
}

/**
 * AuthProvider subscribes to Firebase auth state and syncs it to Zustand.
 * When a Google user signs in, it calls the Bubble /wf/login_google endpoint
 * (matching iOS AuthManager.swift) to get the OPS User + Company directly.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const setFirebaseAuth = useAuthStore((s) => s.setFirebaseAuth);
  const setUser = useAuthStore((s) => s.setUser);
  const setCompany = useAuthStore((s) => s.setCompany);
  const setLoading = useAuthStore((s) => s.setLoading);
  const fetchingRef = useRef(false);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = onAuthStateChanged(async (firebaseUser) => {
      const authenticated = !!firebaseUser;
      setFirebaseAuth(authenticated);
      setAuthCookie(authenticated);

      if (authenticated && firebaseUser && !fetchingRef.current) {
        fetchingRef.current = true;
        try {
          // Get Firebase ID token
          const idToken = await getIdToken();
          if (!idToken || !firebaseUser.email) {
            fetchingRef.current = false;
            return;
          }

          // Call Bubble /wf/login_google (matches iOS flow)
          const result = await UserService.loginWithGoogle(
            idToken,
            firebaseUser.email,
            firebaseUser.displayName || "",
            firebaseUser.displayName?.split(" ")[0] || "",
            firebaseUser.displayName?.split(" ").slice(1).join(" ") || ""
          );

          setUser(result.user);
          if (result.company) {
            setCompany(result.company);
          }
        } catch (err) {
          console.error("[AuthProvider] Failed to fetch OPS user via Bubble workflow:", err);
        } finally {
          fetchingRef.current = false;
        }
      }
    });
    return () => unsubscribe();
  }, [setFirebaseAuth, setUser, setCompany, setLoading]);

  return <>{children}</>;
}
