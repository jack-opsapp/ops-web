"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWindowStore } from "@/stores/window-store";

// `/projects/new` — permanent hand-off to the workspace create window.
//
// This route must NEVER be deleted. Onboarding emails already sitting in
// customer inboxes link straight to it (Day1NoProject CTA, built by
// onboarding-drip-service), so the URL is a public contract. It is the
// canonical "create a project" deep link: it opens the project workspace
// window in creating mode on the dashboard and gets out of the way.
//
// `?clientId=` seeds the window's client field via the meta-carried
// initialClientId (route consolidation 2026-07-03) — the same capability
// the client-list widget's "Create Project" action uses.
//
// Deliberately ungated: like the ⌘K palette (see quick-actions/dispatch.ts),
// deep links dispatch the create window directly — the catalog-setup gate
// is a Create-menu caller concern, and this route never applied it.

function ProjectsNewHandOff() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId");

  // Single-fire guard: React 18 strict/dev double-invokes effects, and the
  // openProjectWindow → replace pair must run exactly once per visit.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    useWindowStore.getState().openProjectWindow({
      projectId: null,
      mode: "creating",
      initialClientId: clientId,
    });
    router.replace("/dashboard");
  }, [clientId, router]);

  return null;
}

export default function NewProjectPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <ProjectsNewHandOff />
    </Suspense>
  );
}
