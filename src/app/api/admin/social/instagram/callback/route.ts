import { getAppUrl } from "@/lib/utils/app-url";
import { createInstagramConnectionService } from "@/lib/social/instagram-connection-service";
import { createInstagramCallbackHandler } from "@/lib/social/instagram-callback-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createInstagramCallbackHandler({
  completeAuthorization: (state, code) =>
    createInstagramConnectionService().completeAuthorization(state, code),
  appUrl: getAppUrl(),
});
