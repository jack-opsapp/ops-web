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
        console.log("[AuthProvider] Firebase user authenticated:", firebaseUser.email, firebaseUser.displayName);
        try {
          // Get Firebase ID token
          const idToken = await getIdToken();
          console.log("[AuthProvider] Got idToken:", idToken ? `${idToken.substring(0, 20)}...` : "NULL");
          if (!idToken || !firebaseUser.email) {
            console.warn("[AuthProvider] Missing idToken or email, aborting");
            fetchingRef.current = false;
            setLoading(false);
            return;
          }

          // Call Bubble /wf/login_google (matches iOS flow)
          console.log("[AuthProvider] Calling UserService.loginWithGoogle...");
          const result = await UserService.loginWithGoogle(
            idToken,
            firebaseUser.email,
            firebaseUser.displayName || "",
            firebaseUser.displayName?.split(" ")[0] || "",
            firebaseUser.displayName?.split(" ").slice(1).join(" ") || ""
          );

          console.log("[AuthProvider] loginWithGoogle result:", {
            userId: result.user.id,
            userName: `${result.user.firstName} ${result.user.lastName}`,
            userRole: result.user.role,
            userCompanyId: result.user.companyId,
            companyName: result.company?.name ?? "null",
            companyId: result.company?.id ?? "null",
            adminIds: result.company?.adminIds ?? [],
          });

          setUser(result.user);
          if (result.company) {
            setCompany(result.company);
            console.log("[AuthProvider] Company set in auth store:", result.company.id);
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
          console.log("[AuthProvider] Done. Loading set to false.");
        }
      } else {
        if (!authenticated) console.log("[AuthProvider] Not authenticated");
        else if (fetchingRef.current) console.log("[AuthProvider] Already fetching, skipping");
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [setFirebaseAuth, setUser, setCompany, setLoading]);

  return <>{children}</>;
}
