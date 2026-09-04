import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/api-auth";
import {
  createInstagramConnectionService,
  type InstagramConnectionService,
} from "@/lib/social/instagram-connection-service";

const NO_STORE = "no-store, max-age=0";

type ConnectionRouteService = Pick<
  InstagramConnectionService,
  "getPublicStatus" | "createAuthorizationUrl" | "disconnect"
>;

export interface AdminSocialInstagramRouteDependencies {
  authenticate: typeof requireAdmin;
  service: ConnectionRouteService;
}

const defaults: AdminSocialInstagramRouteDependencies = {
  authenticate: requireAdmin,
  service: {
    getPublicStatus: () => createInstagramConnectionService().getPublicStatus(),
    createAuthorizationUrl: (email) =>
      createInstagramConnectionService().createAuthorizationUrl(email),
    disconnect: () => createInstagramConnectionService().disconnect(),
  },
};

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": NO_STORE },
  });
}

function withNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", NO_STORE);
  return response;
}

export function createAdminSocialInstagramHandlers(
  dependencies: AdminSocialInstagramRouteDependencies = defaults
) {
  return {
    GET: async (request: NextRequest): Promise<NextResponse> => {
      try {
        await dependencies.authenticate(request);
        return json({
          connection: await dependencies.service.getPublicStatus(),
        });
      } catch (error) {
        if (error instanceof NextResponse) return withNoStore(error);
        console.error("[admin-social-instagram] Status failed");
        return json({ error: "Instagram connection could not be loaded" }, 500);
      }
    },

    POST: async (request: NextRequest): Promise<NextResponse> => {
      try {
        const user = await dependencies.authenticate(request);
        const authorizationUrl =
          await dependencies.service.createAuthorizationUrl(user.email!);
        return json({ authorizationUrl: authorizationUrl.toString() });
      } catch (error) {
        if (error instanceof NextResponse) return withNoStore(error);
        console.error("[admin-social-instagram] Connect initiation failed");
        return json(
          { error: "Instagram connection could not be started" },
          500
        );
      }
    },

    DELETE: async (request: NextRequest): Promise<NextResponse> => {
      try {
        await dependencies.authenticate(request);
        await dependencies.service.disconnect();
        return json({ ok: true });
      } catch (error) {
        if (error instanceof NextResponse) return withNoStore(error);
        console.error("[admin-social-instagram] Disconnect failed");
        return json({ error: "Instagram could not be disconnected" }, 500);
      }
    },
  };
}
