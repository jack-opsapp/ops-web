"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import { onAuthStateChanged } from "@/lib/firebase/auth";

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
      setFirebaseAuth(!!user);
    });
    return () => unsubscribe();
  }, [setFirebaseAuth, setLoading]);

  return <>{children}</>;
}
