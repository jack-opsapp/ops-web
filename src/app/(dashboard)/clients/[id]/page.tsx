"use client";

import { useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";

// Thin fallback (WEB OVERHAUL P3.3). The client detail page is retired — the
// floating client workspace window is the canonical surface. Any control that
// still routes to `/clients/<id>` (command palette, pipeline, inbox links,
// notifications) lands here and is param-preservingly redirected to the
// dashboard deep-link, which swings the window open. Mirrors how
// `/projects/<id>` deep-links the project window.
export default function ClientDetailRedirect() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";

  useEffect(() => {
    if (!id) {
      router.replace("/clients");
      return;
    }
    const next = new URLSearchParams(searchParams.toString());
    next.set("openClient", id);
    // `?mode=edit` on the inbound URL carries through to the window.
    router.replace(`/dashboard?${next.toString()}`);
  }, [id, searchParams, router]);

  return null;
}
