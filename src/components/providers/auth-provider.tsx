"use client";

import { Fragment, useEffect, useRef, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";
import {
  onAuthStateChanged,
  getIdToken,
  checkRedirectResult,
  clearRedirectFlag,
  isRedirectPending,
  clearRedirectContext,
} from "@/lib/firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/config";
import {
  attemptDevBypass,
  isDevBypassEnabled,
} from "@/lib/firebase/dev-bypass";
import { UserService } from "@/lib/api/services/user-service";
import { toast } from "@/components/ui/toast";
import {
  getQueryClient,
  getQueryClientSecurityEpoch,
  redactAllQueryCacheData,
  subscribeToQueryClientSecurityEpoch,
} from "@/lib/api/query-client";
import { UserRole } from "@/lib/types/models";
import { useWindowStore } from "@/stores/window-store";
import { useUndoStore } from "@/stores/undo-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useBreadcrumbStore } from "@/stores/breadcrumb-store";
import { usePipelineModeStore } from "@/app/(dashboard)/pipeline/_components/pipeline-mode-store";
import { useCommunicationDraftStore } from "@/stores/communication-draft-store";

const FIREBASE_ACTOR_BINDING_KEY = "ops-firebase-actor-binding-v1";

interface FirebaseActorBinding {
  firebaseUid: string;
  opsUserId: string;
}

function readFirebaseActorBinding(): FirebaseActorBinding | null {
  try {
    const raw = localStorage.getItem(FIREBASE_ACTOR_BINDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FirebaseActorBinding>;
    return typeof parsed.firebaseUid === "string" &&
      typeof parsed.opsUserId === "string"
      ? { firebaseUid: parsed.firebaseUid, opsUserId: parsed.opsUserId }
      : null;
  } catch {
    return null;
  }
}

function writeFirebaseActorBinding(binding: FirebaseActorBinding): void {
  try {
    localStorage.setItem(FIREBASE_ACTOR_BINDING_KEY, JSON.stringify(binding));
  } catch {
    // Browser privacy/storage failures must never turn an unbound actor into a
    // trusted persisted session. The next boot will perform a canonical sync.
  }
}

function clearFirebaseActorBinding(): void {
  try {
    localStorage.removeItem(FIREBASE_ACTOR_BINDING_KEY);
  } catch {
    // Nothing else can be trusted from storage when removal itself is blocked.
  }
}

function persistedActorMatches(
  firebaseUid: string,
  opsUserId: string | null
): boolean {
  if (!opsUserId) return false;
  const binding = readFirebaseActorBinding();
  return (
    binding?.firebaseUid === firebaseUid && binding.opsUserId === opsUserId
  );
}

/** Drop every actor-owned client authority synchronously before any await. */
function revokePersistedActorAuthority(queryClient: QueryClient): QueryClient {
  const replacementClient = redactAllQueryCacheData(queryClient);
  usePermissionStore.getState().clear();
  useFeatureFlagsStore.getState().clear();
  useWindowStore.getState().clearWindows();
  useUndoStore.getState().clear();
  useSelectionStore.getState().clearSelection();
  useBreadcrumbStore.getState().clearEntityName();
  useBreadcrumbStore.getState().clearParentCrumbs();
  usePipelineModeStore.getState().closeDetailPanel();
  useCommunicationDraftStore.getState().clear();
  useAuthStore.setState({
    currentUser: null,
    company: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
    role: UserRole.Unassigned,
  });
  return replacementClient;
}

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
    // Legacy/server-rendered routes also accept __session, and several prefer
    // it over ops-auth-token. Revocation must clear both names atomically from
    // the browser's perspective or the prior actor can remain authenticated.
    document.cookie = "__session=; path=/; max-age=0";
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
  const queryClient = useQueryClient();
  const queryClientSecurityEpoch = useSyncExternalStore(
    subscribeToQueryClientSecurityEpoch,
    getQueryClientSecurityEpoch,
    getQueryClientSecurityEpoch
  );
  const setFirebaseAuth = useAuthStore((s) => s.setFirebaseAuth);
  const setUser = useAuthStore((s) => s.setUser);
  const setCompany = useAuthStore((s) => s.setCompany);
  const setLoading = useAuthStore((s) => s.setLoading);
  const fetchPermissions = usePermissionStore((s) => s.fetchPermissions);
  const fetchFlags = useFeatureFlagsStore((s) => s.fetchFlags);
  const liveFirebaseUidRef = useRef<string | null>(null);
  const firebaseActorGenerationRef = useRef(0);
  const syncingFirebaseUidsRef = useRef(new Map<string, number>());
  const quarantinedActorKeyRef = useRef<string | null>(null);
  const failedAuthActorKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const syncingFirebaseUids = syncingFirebaseUidsRef.current;
    let cancelled = false;
    setLoading(true);

    // Dev bypass — guard so we only attempt once per AuthProvider mount.
    let bypassAttempted = false;

    // Handle redirect result only if a redirect was actually initiated.
    // We keep a reference to the promise so handleAuthState can defer the
    // unauth conclusion until getRedirectResult actually resolves —
    // onAuthStateChanged fires null synchronously on subscribe, which
    // otherwise races against the redirect processing and eats the ctx.
    let redirectResultPromise: Promise<
      import("firebase/auth").User | null
    > | null = null;
    if (isRedirectPending()) {
      console.log("[AuthProvider] Redirect pending, checking result...");
      clearRedirectFlag();
      redirectResultPromise = checkRedirectResult();
      redirectResultPromise
        .then((redirectUser) => {
          if (redirectUser) {
            console.log(
              "[AuthProvider] Redirect sign-in detected:",
              redirectUser.email
            );
          }
        })
        .catch(() => {
          // The actor-processing wrapper below owns the fail-closed error path
          // when it awaits this same promise.
        });
    }

    const revokeUnauthenticatedClient = () => {
      liveFirebaseUidRef.current = null;
      firebaseActorGenerationRef.current += 1;
      if (quarantinedActorKeyRef.current !== "signed-out") {
        quarantinedActorKeyRef.current = "signed-out";
        revokePersistedActorAuthority(queryClient);
      }
      clearFirebaseActorBinding();
      setAuthCookie(null);
      setFirebaseAuth(false);
    };

    /**
     * Process a Firebase user (or null) into Zustand state.
     * Called from both authStateReady and onAuthStateChanged.
     */
    async function handleAuthState(
      firebaseUser: import("firebase/auth").User | null
    ) {
      if (cancelled) return;

      // If Firebase reports no user but we have a pending redirect result,
      // wait for it before concluding unauth. A synchronous null fire from
      // onAuthStateChanged can precede the redirect's processing — acting on
      // it would clear the freshly-stashed redirect ctx and strand a valid
      // sign-in. If the redirect resolves with a user, Firebase will fire
      // onAuthStateChanged again with that user; we let that call handle it.
      if (!firebaseUser && redirectResultPromise) {
        const redirectUser = await redirectResultPromise;
        redirectResultPromise = null; // single-use defer
        if (cancelled) return;
        if (redirectUser) {
          // Complete the returned actor directly. Firebase normally emits a
          // matching auth-state event too, but that transport callback is not
          // allowed to be the only path out of the loading state.
          return handleAuthState(redirectUser);
        }
        // Redirect resolved to null → genuine unauth, fall through.
      }

      const firebaseUid = firebaseUser?.uid ?? null;
      if (liveFirebaseUidRef.current !== firebaseUid) {
        liveFirebaseUidRef.current = firebaseUid;
        firebaseActorGenerationRef.current += 1;
        quarantinedActorKeyRef.current = null;
        failedAuthActorKeyRef.current = null;
      }
      const actorKey = firebaseUid ?? "signed-out";
      if (failedAuthActorKeyRef.current === actorKey) {
        setFirebaseAuth(false);
        setLoading(false);
        return;
      }
      const actorGeneration = firebaseActorGenerationRef.current;
      const isCurrentActor = () =>
        !cancelled &&
        liveFirebaseUidRef.current === firebaseUid &&
        firebaseActorGenerationRef.current === actorGeneration;

      if (!firebaseUser) {
        // Dev bypass: when NEXT_PUBLIC_DEV_BYPASS_AUTH=true, mint a custom
        // Firebase token via /api/dev/bypass-token and sign in as the
        // selected dev user. Once signed in, Firebase fires
        // onAuthStateChanged again with the bypass user and the normal
        // authed path takes over. Used to test inside the Claude Code
        // preview sandbox where OAuth popups are blocked.
        if (isDevBypassEnabled() && !bypassAttempted) {
          bypassAttempted = true;
          const ok = await attemptDevBypass();
          if (cancelled) return;
          if (ok) return; // wait for the next onAuthStateChanged fire
        }

        revokeUnauthenticatedClient();
        // Safe to clear now: if a redirect was in flight, we awaited it
        // above and confirmed no user came back — any stashed ctx is stale.
        clearRedirectContext();
        console.log("[AuthProvider] Not authenticated");
        setLoading(false);
        return;
      }

      // Persisted OPS state is reusable only when the previous canonical sync
      // bound BOTH identities. A missing/invalid binding is treated exactly as
      // an account switch and revoked before token resolution or network I/O.
      const persistedUserId = useAuthStore.getState().currentUser?.id ?? null;
      const canReusePersistedActor = persistedActorMatches(
        firebaseUser.uid,
        persistedUserId
      );
      if (!canReusePersistedActor) {
        if (quarantinedActorKeyRef.current !== firebaseUser.uid) {
          quarantinedActorKeyRef.current = firebaseUser.uid;
          const replacementClient = revokePersistedActorAuthority(queryClient);
          clearFirebaseActorBinding();
          // The middleware/API cookies belong to the previous Firebase actor.
          // Remove them before token resolution or any other await so an
          // account switch cannot issue server requests under stale identity.
          setAuthCookie(null);
          // The root provider will immediately restart this effect against the
          // replacement client. Stop this generation before it can launch a
          // canonical sync that cleanup would have to discard.
          if (getQueryClient() === replacementClient) return;
        }
      } else {
        quarantinedActorKeyRef.current = null;
        failedAuthActorKeyRef.current = null;
      }
      setFirebaseAuth(true);

      // Get ID token for the cookie (middleware/server needs it)
      const idToken = await getIdToken();
      if (!isCurrentActor()) return;
      if (!idToken) {
        throw new Error("Firebase returned no ID token");
      }
      setAuthCookie(idToken);

      if (syncingFirebaseUids.get(firebaseUser.uid) !== actorGeneration) {
        // Check if the login page already handled this (user already in store)
        const existingUser = useAuthStore.getState().currentUser;
        if (canReusePersistedActor && existingUser?.companyId) {
          console.log(
            "[AuthProvider] User already in store, using cached data.",
            existingUser.id
          );
          // Still load permissions + feature flags if not initialized
          const permState = usePermissionStore.getState();
          if (!permState.initialized) {
            // Boot rehydrate: the session was restored from a cached user, so
            // hold grants through the first canonical load rather than doing a
            // destructive revoke-first drop (a transient failure would strip a
            // still-valid session). A failed load still fails closed.
            fetchPermissions(existingUser.id, { mode: "hold" }).catch((err) =>
              console.error("[AuthProvider] Failed to fetch permissions:", err)
            );
          }
          const flagsState = useFeatureFlagsStore.getState();
          if (!flagsState.initialized) {
            fetchFlags(existingUser.id).catch((err) =>
              console.error(
                "[AuthProvider] Failed to fetch feature flags:",
                err
              )
            );
          }
          setLoading(false);

          // Background sync: refresh user data to catch server-side changes
          // (e.g. onboardingCompleted, role, setup_progress updated by another session)
          if (idToken && firebaseUser.email) {
            UserService.syncUser(
              idToken,
              firebaseUser.email,
              firebaseUser.displayName || undefined,
              firebaseUser.displayName?.split(" ")[0] || undefined,
              firebaseUser.displayName?.split(" ").slice(1).join(" ") ||
                undefined,
              firebaseUser.photoURL || undefined
            )
              .then((result) => {
                if (!isCurrentActor()) return;
                const { setUser: updateUser, setCompany: updateCompany } =
                  useAuthStore.getState();
                if (result.user.id !== existingUser.id) {
                  revokePersistedActorAuthority(queryClient);
                  setFirebaseAuth(true);
                }
                updateUser(result.user);
                if (result.company) updateCompany(result.company);
                writeFirebaseActorBinding({
                  firebaseUid: firebaseUser.uid,
                  opsUserId: result.user.id,
                });
                quarantinedActorKeyRef.current = null;
                failedAuthActorKeyRef.current = null;
                if (result.user.id !== existingUser.id) {
                  void usePermissionStore
                    .getState()
                    .fetchPermissions(result.user.id);
                  void useFeatureFlagsStore
                    .getState()
                    .fetchFlags(result.user.id);
                  setLoading(false);
                }
              })
              .catch((err) => {
                console.warn("[AuthProvider] Background sync failed:", err);
              });
          }
          return;
        }

        syncingFirebaseUids.set(firebaseUser.uid, actorGeneration);
        console.log("[AuthProvider] Syncing user:", firebaseUser.email);
        try {
          if (!firebaseUser.email) {
            throw new Error("Firebase returned no email address");
          }

          const result = await UserService.syncUser(
            idToken,
            firebaseUser.email,
            firebaseUser.displayName || undefined,
            firebaseUser.displayName?.split(" ")[0] || undefined,
            firebaseUser.displayName?.split(" ").slice(1).join(" ") ||
              undefined,
            firebaseUser.photoURL || undefined
          );

          if (!isCurrentActor()) return;

          console.log("[AuthProvider] syncUser result:", {
            userId: result.user.id,
            userRole: result.user.role,
            companyName: result.company?.name ?? "null",
          });

          setUser(result.user);
          if (result.company) {
            setCompany(result.company);
          } else {
            console.warn(
              "[AuthProvider] NO COMPANY returned - hooks will be disabled!"
            );
          }
          writeFirebaseActorBinding({
            firebaseUid: firebaseUser.uid,
            opsUserId: result.user.id,
          });
          quarantinedActorKeyRef.current = null;
          failedAuthActorKeyRef.current = null;

          // Fetch permissions + feature flags for the authenticated user
          fetchPermissions(result.user.id).catch((err) =>
            console.error("[AuthProvider] Failed to fetch permissions:", err)
          );
          fetchFlags(result.user.id).catch((err) =>
            console.error("[AuthProvider] Failed to fetch feature flags:", err)
          );
        } catch (err) {
          if (!isCurrentActor()) return;
          console.error("[AuthProvider] syncUser FAILED:", err);
          toast.error("Failed to load user data", {
            description: "Please try signing out and back in.",
          });
          // The outer actor-processing boundary owns the terminal revoke.
          // Swallowing this error would leave Firebase marked authenticated
          // without a canonical OPS user or company.
          throw err;
        } finally {
          if (syncingFirebaseUids.get(firebaseUser.uid) === actorGeneration) {
            syncingFirebaseUids.delete(firebaseUser.uid);
          }
          if (isCurrentActor()) setLoading(false);
        }
      } else {
        console.log(
          "[AuthProvider] Already syncing this Firebase actor, skipping"
        );
      }
    }

    let authAttemptGeneration = 0;
    let authProcessingTimeout: ReturnType<typeof setTimeout> | null = null;
    let activeAuthProcessing: {
      actorKey: string;
      generation: number;
    } | null = null;

    const clearAuthProcessingTimeout = () => {
      if (!authProcessingTimeout) return;
      clearTimeout(authProcessingTimeout);
      authProcessingTimeout = null;
    };

    const failAuthProcessing = (
      firebaseUser: import("firebase/auth").User | null,
      error: unknown
    ) => {
      if (cancelled) return;
      const actorKey = firebaseUser?.uid ?? "signed-out";
      failedAuthActorKeyRef.current = actorKey;
      console.error("[AuthProvider] Auth processing failed:", error);

      if (firebaseUser) {
        firebaseActorGenerationRef.current += 1;
        quarantinedActorKeyRef.current = actorKey;
        revokePersistedActorAuthority(queryClient);
        clearFirebaseActorBinding();
        setAuthCookie(null);
        setFirebaseAuth(false);
      } else {
        revokeUnauthenticatedClient();
      }
      setLoading(false);
    };

    const processAuthState = (
      firebaseUser: import("firebase/auth").User | null
    ) => {
      const actorKey = firebaseUser?.uid ?? "signed-out";
      // Firebase can deliver the same actor through authStateReady,
      // onAuthStateChanged, and token-refresh callbacks while the canonical
      // sync is still running. A duplicate must not replace the only timeout
      // protecting that in-flight sync.
      if (activeAuthProcessing?.actorKey === actorKey) return;

      const attemptGeneration = ++authAttemptGeneration;
      activeAuthProcessing = { actorKey, generation: attemptGeneration };
      clearAuthProcessingTimeout();
      authProcessingTimeout = setTimeout(() => {
        if (cancelled || attemptGeneration !== authAttemptGeneration) return;
        authAttemptGeneration += 1;
        activeAuthProcessing = null;
        failAuthProcessing(
          firebaseUser,
          new Error("Authentication processing timed out after 10 seconds")
        );
      }, 10_000);

      void handleAuthState(firebaseUser)
        .then(() => {
          if (attemptGeneration !== authAttemptGeneration) return;
          activeAuthProcessing = null;
          clearAuthProcessingTimeout();
        })
        .catch((error) => {
          if (cancelled || attemptGeneration !== authAttemptGeneration) return;
          authAttemptGeneration += 1;
          activeAuthProcessing = null;
          clearAuthProcessingTimeout();
          failAuthProcessing(firebaseUser, error);
        });
    };

    // ── Primary: authStateReady() ───────────────────────────────────────────
    // Resolves when Firebase has determined auth state. Unlike
    // onAuthStateChanged, this doesn't block on redirect resolution.
    const firebaseAuth = getFirebaseAuth();
    let initialCheckDone = false;

    console.log("[AuthProvider] Calling authStateReady()...");
    firebaseAuth
      .authStateReady()
      .then(() => {
        if (cancelled || initialCheckDone) return;
        initialCheckDone = true;
        console.log(
          "[AuthProvider] authStateReady resolved, currentUser:",
          !!firebaseAuth.currentUser
        );
        processAuthState(firebaseAuth.currentUser);
      })
      .catch((err) => {
        console.error("[AuthProvider] authStateReady failed:", err);
        if (!cancelled && !initialCheckDone) {
          initialCheckDone = true;
          failAuthProcessing(firebaseAuth.currentUser, err);
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
          processAuthState(firebaseUser);
        } else {
          // Subsequent fires — handle state changes (sign-out, token refresh)
          processAuthState(firebaseUser);
        }
      });
    } catch (err) {
      console.error("[AuthProvider] Firebase init error:", err);
      if (!initialCheckDone) {
        initialCheckDone = true;
        failAuthProcessing(null, err);
      }
    }

    // ── Fallback: hard timeout ──────────────────────────────────────────────
    // A redirect may legitimately take longer than the normal 3-second
    // Firebase bootstrap, but it still needs a terminal deadline even when
    // neither Firebase callback ever arrives to start processAuthState.
    const initialAuthTimeoutMs = redirectResultPromise ? 10_000 : 3_000;
    const timeout = setTimeout(() => {
      if (!initialCheckDone) {
        console.warn("[AuthProvider] Initial auth signal timed out");
        initialCheckDone = true;
        failAuthProcessing(
          firebaseAuth.currentUser,
          new Error(
            `Authentication signal timed out after ${initialAuthTimeoutMs / 1000} seconds`
          )
        );
      }
    }, initialAuthTimeoutMs);

    return () => {
      cancelled = true;
      // Every entry belongs to this effect generation. A replacement effect
      // must be able to start a fresh canonical sync immediately; otherwise a
      // discarded pending request can strand the next generation as "already
      // syncing" forever.
      syncingFirebaseUids.clear();
      clearTimeout(timeout);
      clearAuthProcessingTimeout();
      if (unsubscribe) unsubscribe();
    };
  }, [
    queryClient,
    setFirebaseAuth,
    setUser,
    setCompany,
    setLoading,
    fetchPermissions,
    fetchFlags,
  ]);

  return <Fragment key={queryClientSecurityEpoch}>{children}</Fragment>;
}
