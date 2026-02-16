"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { onAuthStateChanged } from "@/lib/firebase/auth";

/**
 * AuthProvider subscribes to Firebase auth state and syncs it to Zustand.
 * Wrap this around any part of the tree that needs auth awareness.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const setUser = useAuthStore((s) => s.setUser);
  const setLoading = useAuthStore((s) => s.setLoading);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = onAuthStateChanged((user) => {
      setUser(user);
    });
    return () => unsubscribe();
  }, [setUser, setLoading]);

  return <>{children}</>;
}
