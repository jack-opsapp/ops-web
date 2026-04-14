"use client";

/**
 * S2 Amendment — /agent/comms-config page
 *
 * Renders the CommsConfigWizard. Gated by:
 *   - Authenticated session (via the dashboard layout)
 *   - Admin/owner role (checked inside the wizard's save endpoint)
 *   - phase_c feature flag (checked client-side, redirects to /agent/queue otherwise)
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useDictionary } from "@/i18n/client";
import { CommsConfigWizard } from "@/components/agent/comms-config-wizard";
import { Loader2 } from "lucide-react";

export default function CommsConfigPage() {
  const { t } = useDictionary("comms-wizard");
  const router = useRouter();
  const { company, currentUser } = useAuthStore();

  usePageTitle(t("page.title"));

  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (!company?.id || !currentUser?.id) return;
    let cancelled = false;

    (async () => {
      // Role check — wizard is admin/owner only
      const role = (currentUser.role as string) ?? "";
      if (!["admin", "owner"].includes(role)) {
        if (!cancelled) {
          router.replace("/agent/queue");
        }
        return;
      }

      try {
        const { getIdToken } = await import("@/lib/firebase/auth");
        const idToken = await getIdToken();

        const res = await fetch(`/api/agent/comms-wizard/gating`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) {
          if (!cancelled) router.replace("/agent/queue");
          return;
        }
        const data = await res.json();
        if (!data.phaseCEnabled) {
          if (!cancelled) router.replace("/agent/queue");
          return;
        }
        if (!cancelled) {
          setAllowed(true);
          setChecking(false);
        }
      } catch {
        if (!cancelled) router.replace("/agent/queue");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [company?.id, currentUser?.id, currentUser?.role, router]);

  if (checking) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-[18px] h-[18px] text-text-tertiary animate-spin motion-reduce:animate-none" />
      </div>
    );
  }

  if (!allowed) return null;

  return <CommsConfigWizard />;
}
