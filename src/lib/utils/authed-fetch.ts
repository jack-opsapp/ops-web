/**
 * OPS Web - Authed Fetch
 *
 * fetch() wrapper that attaches the current Firebase ID token to the
 * Authorization header. If the server rejects with 401 (typical when a token
 * expires during a long polling loop or minimized wizard), it force-refreshes
 * the token and retries the request once before surfacing the error.
 *
 * Use this for any client-side polling of authed API routes — the naked
 * `fetch()` pattern relies on session cookies which aren't guaranteed to
 * refresh in step with Firebase's token rotation, so long-running UIs
 * silently go dark when the cookie-backed token ages out.
 */

import { getIdToken } from "@/lib/firebase/auth";

export async function authedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const token = await getIdToken();

  const buildHeaders = (bearer: string | null): HeadersInit => {
    const base: Record<string, string> = {};
    // Copy init?.headers into a plain record without clobbering case
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => { base[k] = v; });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) base[k] = v;
      } else {
        Object.assign(base, init.headers as Record<string, string>);
      }
    }
    if (bearer) base["Authorization"] = `Bearer ${bearer}`;
    return base;
  };

  const res = await fetch(input, {
    ...init,
    headers: buildHeaders(token),
  });

  if (res.status !== 401) return res;

  // Token likely expired mid-session — force-refresh and retry once.
  const fresh = await getIdToken(true);
  if (!fresh) return res;

  return fetch(input, {
    ...init,
    headers: buildHeaders(fresh),
  });
}
