"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Retired (WEB OVERHAUL P3.3 D2). Creating a client now lives in the floating
// client workspace window's `creating` mode. This route redirects to the
// dashboard deep-link, which the handler opens in creating mode.
export default function NewClientRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard?openClient=new");
  }, [router]);
  return null;
}
