"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { OpsLockup } from "@/components/brand";
import { AuthProvider } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { getIdToken } from "@/lib/firebase/auth";
import { useAuthStore } from "@/lib/store/auth-store";

/**
 * The consent decision surface for the OPS remote MCP mount.
 *
 * One question, one panel: who is asking, which OPS company it touches, what
 * it can do (read-only), exactly what it can see, then approve or deny. No
 * dashboard chrome — an operator arriving here from Claude is mid-handshake,
 * not navigating the product, so navigation would only offer ways to abandon
 * the flow halfway.
 *
 * Trust boundary: this component never decides anything. It carries the raw
 * authorization parameters to two Firebase-authenticated endpoints that
 * re-validate every one of them server-side, and it only ever navigates to a
 * `redirect_to` those endpoints built. A non-200 from either side renders the
 * invalid state — an unvalidated redirect target is never navigated.
 */

export interface ConsentPanelProps {
  readonly clientId: string | null;
  readonly redirectUri: string | null;
  readonly responseType: string | null;
  readonly scope: string | null;
  readonly state: string | null;
  readonly codeChallenge: string | null;
  readonly codeChallengeMethod: string | null;
  readonly resource: string | null;
}

interface ConsentScopeLine {
  readonly scope: string;
  readonly label: string;
}

interface ConsentContext {
  readonly clientName: string;
  readonly companyName: string;
  readonly scopes: readonly ConsentScopeLine[];
}

type Phase = "verifying" | "ready" | "invalid";
type Decision = "approve" | "deny";

const CONTEXT_ENDPOINT = "/api/mcp/oauth/authorize/context";
const DECISION_ENDPOINT = "/api/mcp/oauth/authorize/decision";

/** DESIGN.md §4 — JetBrains Mono 11px uppercase tactical label, 0.16em. */
const MICRO_LABEL = "font-mono text-micro tracking-[0.16em] text-text-3";
/** DESIGN.md §4 — Cake Mono 300 display voice, always uppercase. */
const DISPLAY_TITLE =
  "font-cakemono font-light text-cake-display uppercase tracking-wider text-text";
/** DESIGN.md §4 — Mohave 400 14px, sentence-case content and entity names. */
const BODY_TEXT = "font-mohave text-card-body";

function parseContext(value: unknown): ConsentContext | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.clientName !== "string" || record.clientName === "") {
    return null;
  }
  if (typeof record.companyName !== "string" || record.companyName === "") {
    return null;
  }
  if (!Array.isArray(record.scopes) || record.scopes.length === 0) return null;
  const scopes: ConsentScopeLine[] = [];
  for (const entry of record.scopes) {
    if (typeof entry !== "object" || entry === null) return null;
    const line = entry as Record<string, unknown>;
    if (typeof line.scope !== "string" || line.scope === "") return null;
    if (typeof line.label !== "string" || line.label === "") return null;
    scopes.push({ scope: line.scope, label: line.label });
  }
  return {
    clientName: record.clientName,
    companyName: record.companyName,
    scopes,
  };
}

function readRedirectTarget(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  return typeof record.redirect_to === "string" && record.redirect_to !== ""
    ? record.redirect_to
    : null;
}

export function ConsentPanel(props: ConsentPanelProps) {
  return (
    <AuthProvider>
      <ConsentPanelBody {...props} />
    </AuthProvider>
  );
}

function ConsentPanelBody({
  clientId,
  redirectUri,
  responseType,
  scope,
  state,
  codeChallenge,
  codeChallengeMethod,
  resource,
}: ConsentPanelProps) {
  const isLoadingAuth = useAuthStore((s) => s.isLoading);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [phase, setPhase] = useState<Phase>("verifying");
  const [context, setContext] = useState<ConsentContext | null>(null);
  const [pending, setPending] = useState<Decision | null>(null);

  // The context probe and every navigation must fire exactly once, even
  // though the auth store settles across several renders.
  const contextRequestedRef = useRef(false);
  const leavingRef = useRef(false);

  const leaveTo = useCallback((target: string) => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    window.location.assign(target);
  }, []);

  // ── Unauthenticated → the app's own sign-in, returning here ──────────────
  // `redirect` is the login page's post-auth param; it sanitizes the value
  // through safeRedirectPath, and a root-relative path survives that guard.
  useEffect(() => {
    if (isLoadingAuth || isAuthenticated || leavingRef.current) return;
    leavingRef.current = true;
    const here = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`/login?redirect=${encodeURIComponent(here)}`);
  }, [isLoadingAuth, isAuthenticated]);

  // ── Authenticated → resolve who is asking, and for what ──────────────────
  useEffect(() => {
    if (isLoadingAuth || !isAuthenticated) return;
    if (contextRequestedRef.current) return;
    contextRequestedRef.current = true;

    let cancelled = false;

    void (async () => {
      try {
        const idToken = await getIdToken();
        if (cancelled) return;
        if (!idToken) {
          // The store believes there is a session but Firebase has no live
          // actor. Treat it exactly like signed-out rather than probing with
          // no credential.
          if (leavingRef.current) return;
          leavingRef.current = true;
          const here = `${window.location.pathname}${window.location.search}`;
          window.location.replace(`/login?redirect=${encodeURIComponent(here)}`);
          return;
        }

        const response = await fetch(CONTEXT_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: clientId,
            redirect_uri: redirectUri,
            scope,
          }),
        });
        if (cancelled) return;
        if (!response.ok) {
          setPhase("invalid");
          return;
        }
        const parsed = parseContext(await response.json());
        if (cancelled) return;
        if (!parsed) {
          setPhase("invalid");
          return;
        }
        setContext(parsed);
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("invalid");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoadingAuth, isAuthenticated, clientId, redirectUri, scope]);

  const submit = useCallback(
    async (decision: Decision) => {
      if (pending !== null || leavingRef.current) return;
      setPending(decision);
      try {
        const idToken = await getIdToken();
        if (!idToken) {
          setPending(null);
          setPhase("invalid");
          return;
        }
        const response = await fetch(DECISION_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            decision,
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: responseType,
            scope,
            state,
            code_challenge: codeChallenge,
            code_challenge_method: codeChallengeMethod,
            resource,
          }),
        });
        if (!response.ok) {
          setPending(null);
          setPhase("invalid");
          return;
        }
        const target = readRedirectTarget(await response.json());
        if (!target) {
          setPending(null);
          setPhase("invalid");
          return;
        }
        leaveTo(target);
      } catch {
        setPending(null);
        setPhase("invalid");
      }
    },
    [
      pending,
      leaveTo,
      clientId,
      redirectUri,
      responseType,
      scope,
      state,
      codeChallenge,
      codeChallengeMethod,
      resource,
    ]
  );

  if (phase === "invalid") {
    return (
      <ConsentShell>
        <h1 className={DISPLAY_TITLE}>
          <span className="text-text-mute">{"// "}</span>
          CONNECT
        </h1>
        <p className={`mt-2 ${BODY_TEXT} text-text-2`}>
          This connection request is invalid or expired.
        </p>
        <p className="mt-3 font-mono text-micro text-text-3">
          [close this tab and reconnect from Claude]
        </p>
      </ConsentShell>
    );
  }

  if (phase !== "ready" || context === null) {
    return (
      <ConsentShell>
        <p className={MICRO_LABEL}>SYS :: VERIFYING</p>
      </ConsentShell>
    );
  }

  const inFlight = pending !== null;

  return (
    <ConsentShell>
      <h1 className={DISPLAY_TITLE}>
        <span className="text-text-mute">{"// "}</span>
        CONNECT
        <span className="text-text-mute">{" :: "}</span>
        {context.clientName.toUpperCase()}
      </h1>

      <div className="mt-3">
        <p className={MICRO_LABEL}>COMPANY</p>
        <p className={`mt-0.5 ${BODY_TEXT} text-text`}>{context.companyName}</p>
      </div>

      <p className={`mt-2 ${BODY_TEXT} text-text-2`}>
        Read-only. Nothing gets changed in OPS.
      </p>

      <div className="mt-3">
        <p className={MICRO_LABEL}>CAN VIEW</p>
        <ul className="mt-1 border-t border-line">
          {context.scopes.map((line) => (
            <li
              key={line.scope}
              className={`border-b border-line py-1 ${BODY_TEXT} text-text-2`}
            >
              {line.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 flex items-center gap-1">
        <Button
          variant="primary"
          onClick={() => void submit("approve")}
          disabled={inFlight}
          loading={pending === "approve"}
        >
          APPROVE
        </Button>
        <Button
          variant="ghost"
          onClick={() => void submit("deny")}
          disabled={inFlight}
          loading={pending === "deny"}
        >
          DENY
        </Button>
      </div>

      <p className="mt-3 font-mono text-micro text-text-3">
        [revoke anytime in settings &rarr; integrations]
      </p>
    </ConsentShell>
  );
}

/**
 * One glass panel on the black canvas, brand mark above it. The mark is the
 * only decoration and it is load-bearing: an operator being asked to hand an
 * outside agent access to their business needs to see, unambiguously, whose
 * screen this is.
 */
function ConsentShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-md">
      <div className="mb-2 text-text">
        <OpsLockup
          orientation="horizontal"
          className="h-icon-24 w-auto"
          title="OPS"
        />
      </div>
      <section className="glass-surface rounded-panel px-3 py-3">
        {children}
      </section>
    </div>
  );
}
