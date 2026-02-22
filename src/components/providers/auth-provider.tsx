"use client";

import { useEffect, useRef } from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import { onAuthStateChanged, getIdToken } from "@/lib/firebase/auth";
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
 * AuthProvider subscribes to Firebase auth state and syncs it to Zustand.
 *
 * Important: The LoginPage handles the initial syncUser call during
 * a fresh sign-in. AuthProvider only calls syncUser when Firebase
 * detects an existing session on page reload (no user in Zustand store yet).
 * This prevents the duplicate/triple API calls that were happening before.
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

      if (!authenticated) {
        setAuthCookie(null);
        console.log("[AuthProvider] Not authenticated");
        setLoading(false);
        return;
      }

      // Always get the real ID token for the cookie (middleware/server needs it)
      const idToken = await getIdToken();
      setAuthCookie(idToken);

      if (firebaseUser && !fetchingRef.current) {
        // Check if the login page already handled this (user already in store)
        const existingUser = useAuthStore.getState().currentUser;
        if (existingUser?.companyId) {
          console.log("[AuthProvider] User already in store (login page handled it), skipping API call.", existingUser.id);
          setLoading(false);
          return;
        }

        fetchingRef.current = true;
        console.log("[AuthProvider] Firebase user authenticated, no user in store — calling syncUser:", firebaseUser.email);
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
        } catch (err) {
          console.error("[AuthProvider] FAILED:", err);
          toast.error("Failed to load user data", {
            description: "Please try signing out and back in.",
          });
        } finally {
          fetchingRef.current = false;
          setLoading(false);
        }
      } else if (fetchingRef.current) {
        console.log("[AuthProvider] Already fetching, skipping");
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [setFirebaseAuth, setUser, setCompany, setLoading]);

  return <>{children}</>;
}
