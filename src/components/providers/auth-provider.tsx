"use client";

import { useEffect, useRef } from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import { onAuthStateChanged } from "@/lib/firebase/auth";
import { getBubbleClient } from "@/lib/api/bubble-client";
import {
  BubbleTypes,
  BubbleConstraintType,
} from "@/lib/constants/bubble-fields";
import {
  type UserDTO,
  type CompanyDTO,
  type BubbleListResponse,
  type BubbleObjectResponse,
  userDtoToModel,
  companyDtoToModel,
} from "@/lib/types/dto";

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
 * Look up the OPS user in Bubble by email, then fetch their company.
 * This bridges Firebase auth (which only gives us email/uid) to the
 * full OPS user profile stored in Bubble.io.
 */
async function fetchOpsUserByEmail(email: string) {
  const client = getBubbleClient();

  // Search for user by email in Bubble
  const constraints = JSON.stringify([
    {
      key: "email",
      constraint_type: BubbleConstraintType.equals,
      value: email,
    },
  ]);

  const userResponse = await client.get<BubbleListResponse<UserDTO>>(
    `/obj/${BubbleTypes.user.toLowerCase()}`,
    { params: { constraints, limit: 1 } }
  );

  const userDto = userResponse.response.results[0];
  if (!userDto) return null;

  // Fetch company if user has one
  let company = null;
  let adminIds: string[] = [];
  if (userDto.company) {
    try {
      const companyResponse = await client.get<BubbleObjectResponse<CompanyDTO>>(
        `/obj/${BubbleTypes.company.toLowerCase()}/${userDto.company}`
      );
      company = companyDtoToModel(companyResponse.response);
      adminIds = company.adminIds ?? [];
    } catch {
      // Company fetch failed - continue with user only
    }
  }

  const user = userDtoToModel(userDto, adminIds);

  return { user, company };
}

/**
 * AuthProvider subscribes to Firebase auth state and syncs it to Zustand.
 * When a user signs in, it fetches their OPS profile from Bubble.io.
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

      if (authenticated && firebaseUser?.email && !fetchingRef.current) {
        fetchingRef.current = true;
        try {
          const result = await fetchOpsUserByEmail(firebaseUser.email);
          if (result) {
            setUser(result.user);
            if (result.company) {
              setCompany(result.company);
            }
          }
        } catch (err) {
          console.error("[AuthProvider] Failed to fetch OPS user:", err);
        } finally {
          fetchingRef.current = false;
        }
      }
    });
    return () => unsubscribe();
  }, [setFirebaseAuth, setUser, setCompany, setLoading]);

  return <>{children}</>;
}
