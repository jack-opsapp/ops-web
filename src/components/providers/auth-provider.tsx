"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import { onAuthStateChanged } from "@/lib/firebase/auth";

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
 * Wrap this around any part of the tree that needs auth awareness.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const setFirebaseAuth = useAuthStore((s) => s.setFirebaseAuth);
  const setLoading = useAuthStore((s) => s.setLoading);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = onAuthStateChanged((user) => {
      const authenticated = !!user;
      setFirebaseAuth(authenticated);
      setAuthCookie(authenticated);
    });
    return () => unsubscribe();
  }, [setFirebaseAuth, setLoading]);

  return <>{children}</>;
}
