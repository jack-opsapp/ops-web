import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/utils/app-url";
import {
  createInstagramConnectionService,
  type InstagramConnectionStatus,
} from "@/lib/social/instagram-connection-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = "no-store, max-age=0";

export interface InstagramCallbackDependencies {
  completeAuthorization: (
    state: string,
    code: string
  ) => Promise<InstagramConnectionStatus>;
  appUrl: string;
}

function redirect(appUrl: string, result: string, reason?: string): NextResponse {
  const destination = new URL("/admin/social", appUrl);
  destination.searchParams.set("instagram", result);
  if (reason) destination.searchParams.set("reason", reason);
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", NO_STORE);
  return response;
}

export function createInstagramCallbackHandler(
  dependencies: InstagramCallbackDependencies
) {
  return async function handleInstagramCallback(
    request: NextRequest
  ): Promise<NextResponse> {
    const state = request.nextUrl.searchParams.get("state")?.trim() ?? "";
    const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
    const providerError =
      request.nextUrl.searchParams.get("error")?.trim() ?? "";

    if (providerError) {
      return redirect(dependencies.appUrl, "failed", "denied");
    }
    if (!state || !code || state.length > 512 || code.length > 2048) {
      return redirect(dependencies.appUrl, "failed", "invalid_callback");
    }

    try {
      await dependencies.completeAuthorization(state, code);
      return redirect(dependencies.appUrl, "connected");
    } catch {
      console.error("[admin-social-instagram] OAuth callback failed");
      return redirect(dependencies.appUrl, "failed", "connection");
    }
  };
}

export const GET = createInstagramCallbackHandler({
  completeAuthorization: (state, code) =>
    createInstagramConnectionService().completeAuthorization(state, code),
  appUrl: getAppUrl(),
});
