"use client";

/**
 * Dev-only auth bypass — client side.
 *
 * When NEXT_PUBLIC_DEV_BYPASS_AUTH=true, fetches a Firebase custom token
 * from /api/dev/bypass-token and signs in as a hardcoded developer
 * account. Identity is selected by a `dev-bypass-user` cookie; the server
 * route holds the allow-list of valid keys → emails. Used for testing
 * inside the Claude Code preview sandbox where OAuth popups are blocked.
 */

import { signInWithCustomToken } from "firebase/auth";
import { getFirebaseAuth } from "./config";

export interface BypassUserMeta {
  key: string;
  email: string;
  label: string;
}

export interface BypassMetaResponse extends BypassUserMeta {
  available: BypassUserMeta[];
}

const COOKIE_NAME = "dev-bypass-user";

export function isDevBypassEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true";
}

export function readBypassUserCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]+)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export function writeBypassUserCookie(key: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(key)}; path=/; max-age=2592000; SameSite=Lax`;
}

export async function fetchBypassMeta(): Promise<BypassMetaResponse | null> {
  if (!isDevBypassEnabled()) return null;
  try {
    const res = await fetch("/api/dev/bypass-token", { method: "GET" });
    if (!res.ok) return null;
    return (await res.json()) as BypassMetaResponse;
  } catch {
    return null;
  }
}

export async function attemptDevBypass(): Promise<boolean> {
  if (!isDevBypassEnabled()) return false;

  try {
    const res = await fetch("/api/dev/bypass-token", { method: "POST" });
    if (!res.ok) {
      console.warn(
        `[dev-bypass] Token endpoint returned ${res.status}. Confirm DEV_BYPASS_AUTH=true in .env.local AND restart the dev server.`
      );
      return false;
    }
    const { token, email } = (await res.json()) as {
      token?: string;
      email?: string;
    };
    if (!token) return false;
    const auth = getFirebaseAuth();
    await signInWithCustomToken(auth, token);
    console.log(`[dev-bypass] Signed in as ${email ?? "unknown"} via custom token`);
    return true;
  } catch (err) {
    console.error("[dev-bypass] Failed:", err);
    return false;
  }
}

export async function switchBypassUser(key: string): Promise<void> {
  if (!isDevBypassEnabled()) return;
  writeBypassUserCookie(key);
  if (typeof document !== "undefined") {
    document.cookie = "ops-auth-token=; path=/; max-age=0";
  }
  try {
    const auth = getFirebaseAuth();
    await auth.signOut();
  } catch (err) {
    console.warn("[dev-bypass] signOut failed before switch:", err);
  }
  window.location.reload();
}
