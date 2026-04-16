/**
 * social-publish-instagram
 *
 * Publishes images to Instagram via the Graph API.
 * Supports single image posts and carousels (up to 10 images).
 *
 * Required env vars (set via Supabase Dashboard → Edge Functions → Secrets):
 *   INSTAGRAM_ACCESS_TOKEN  — Long-lived user access token
 *   INSTAGRAM_USER_ID       — IG Business Account user ID
 *   SOCIAL_PUBLISH_SECRET   — Shared secret to auth requests (prevents public abuse)
 *
 * Usage:
 *   POST /social-publish-instagram
 *   Headers: { "Authorization": "Bearer <SOCIAL_PUBLISH_SECRET>" }
 *   Body: {
 *     "image_urls": ["https://...supabase.co/storage/v1/object/public/social-media/..."],
 *     "caption": "Post caption here #OPS #trades",
 *     "post_type": "carousel" | "single"  // optional, auto-detected from array length
 *   }
 *
 * Instagram Graph API flow:
 *   Single:   create container → publish
 *   Carousel: create child containers → create carousel container → publish
 *
 * Token refresh: Long-lived tokens last 60 days. This function checks expiry
 * and returns a warning header if the token expires within 7 days.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const IG_API = "https://graph.facebook.com/v21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PublishRequest {
  image_urls: string[];
  caption: string;
  post_type?: "carousel" | "single";
}

interface IGMediaResponse {
  id: string;
  error?: { message: string; code: number };
}

// ─── Helpers ──────────────────────────────────────────────────

async function createMediaContainer(
  igUserId: string,
  token: string,
  imageUrl: string,
  isCarouselItem: boolean,
  caption?: string,
): Promise<string> {
  const params = new URLSearchParams({
    image_url: imageUrl,
    access_token: token,
  });

  if (isCarouselItem) {
    params.set("is_carousel_item", "true");
  } else if (caption) {
    params.set("caption", caption);
  }

  const resp = await fetch(`${IG_API}/${igUserId}/media`, {
    method: "POST",
    body: params,
  });

  const data: IGMediaResponse = await resp.json();
  if (data.error) {
    throw new Error(`IG media container error: ${data.error.message} (code ${data.error.code})`);
  }
  return data.id;
}

async function createCarouselContainer(
  igUserId: string,
  token: string,
  childIds: string[],
  caption: string,
): Promise<string> {
  const params = new URLSearchParams({
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption: caption,
    access_token: token,
  });

  const resp = await fetch(`${IG_API}/${igUserId}/media`, {
    method: "POST",
    body: params,
  });

  const data: IGMediaResponse = await resp.json();
  if (data.error) {
    throw new Error(`IG carousel container error: ${data.error.message} (code ${data.error.code})`);
  }
  return data.id;
}

async function publishContainer(
  igUserId: string,
  token: string,
  containerId: string,
): Promise<string> {
  const params = new URLSearchParams({
    creation_id: containerId,
    access_token: token,
  });

  const resp = await fetch(`${IG_API}/${igUserId}/media_publish`, {
    method: "POST",
    body: params,
  });

  const data: IGMediaResponse = await resp.json();
  if (data.error) {
    throw new Error(`IG publish error: ${data.error.message} (code ${data.error.code})`);
  }
  return data.id;
}

async function waitForContainerReady(
  token: string,
  containerId: string,
  maxAttempts = 20,
  delayMs = 3000,
): Promise<void> {
  /**
   * Instagram processes media asynchronously. We poll the container status
   * until it's FINISHED (ready to publish) or ERROR.
   */
  for (let i = 0; i < maxAttempts; i++) {
    const resp = await fetch(
      `${IG_API}/${containerId}?fields=status_code&access_token=${token}`,
    );
    const data = await resp.json();

    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") {
      throw new Error(`IG container processing failed: ${JSON.stringify(data)}`);
    }

    // Still processing — wait and retry
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`IG container not ready after ${maxAttempts} attempts`);
}

async function checkTokenExpiry(token: string): Promise<number | null> {
  /**
   * Returns days until token expiry, or null if can't determine.
   * Long-lived tokens last 60 days and should be refreshed before they expire.
   */
  try {
    const resp = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${token}&access_token=${token}`,
    );
    const data = await resp.json();
    if (data.data?.expires_at) {
      const expiresAt = data.data.expires_at * 1000;
      const daysLeft = Math.floor((expiresAt - Date.now()) / (1000 * 60 * 60 * 24));
      return daysLeft;
    }
  } catch {
    // Token debug endpoint not available — skip
  }
  return null;
}

// ─── Main Handler ────────────────────────────────────────────

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    const publishSecret = Deno.env.get("SOCIAL_PUBLISH_SECRET");
    if (publishSecret && authHeader !== `Bearer ${publishSecret}`) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = Deno.env.get("INSTAGRAM_ACCESS_TOKEN");
    const igUserId = Deno.env.get("INSTAGRAM_USER_ID");

    if (!token || !igUserId) {
      return new Response(
        JSON.stringify({
          error: "Missing INSTAGRAM_ACCESS_TOKEN or INSTAGRAM_USER_ID env vars",
          setup: {
            step1: "Go to Meta Developer Portal → Your App → Instagram Graph API",
            step2: "Generate a long-lived user access token",
            step3: "Get your IG Business Account ID via GET /me?fields=id",
            step4: "Set both as Edge Function secrets in Supabase Dashboard",
          },
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body: PublishRequest = await req.json();
    const { image_urls, caption } = body;

    if (!image_urls?.length || !caption) {
      return new Response(
        JSON.stringify({ error: "Required: image_urls (array) and caption (string)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (image_urls.length > 10) {
      return new Response(
        JSON.stringify({ error: "Instagram carousels support max 10 images" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Determine post type
    const isCarousel = body.post_type === "carousel" || image_urls.length > 1;
    let postId: string;

    if (isCarousel) {
      // ─── Carousel flow ───
      // 1. Create child containers (in parallel)
      const childIds = await Promise.all(
        image_urls.map((url) => createMediaContainer(igUserId, token, url, true)),
      );

      // 2. Wait for all children to be processed
      await Promise.all(
        childIds.map((id) => waitForContainerReady(token, id)),
      );

      // 3. Create carousel container
      const carouselId = await createCarouselContainer(igUserId, token, childIds, caption);

      // 4. Wait for carousel to be ready
      await waitForContainerReady(token, carouselId);

      // 5. Publish
      postId = await publishContainer(igUserId, token, carouselId);
    } else {
      // ─── Single image flow ───
      const containerId = await createMediaContainer(igUserId, token, image_urls[0], false, caption);
      await waitForContainerReady(token, containerId);
      postId = await publishContainer(igUserId, token, containerId);
    }

    // Check token expiry and warn if close
    const daysLeft = await checkTokenExpiry(token);
    const headers: Record<string, string> = {
      ...corsHeaders,
      "Content-Type": "application/json",
    };
    if (daysLeft !== null && daysLeft < 7) {
      headers["X-Token-Warning"] = `Instagram token expires in ${daysLeft} days — refresh it`;
    }

    return new Response(
      JSON.stringify({
        success: true,
        post_id: postId,
        type: isCarousel ? "carousel" : "single",
        image_count: image_urls.length,
        token_days_remaining: daysLeft,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
