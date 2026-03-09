"use client";

import { AlertCircle } from "lucide-react";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { PRESET_ROLE_IDS } from "@/lib/types/permissions";

export function UnassignedRoleBanner() {
  const roleId = usePermissionStore((s) => s.roleId);

  if (roleId !== PRESET_ROLE_IDS.UNASSIGNED) return null;

  return (
    <div className="bg-ops-amber/10 border-b border-ops-amber/20 px-4 py-2 flex items-center gap-3 shrink-0">
      <AlertCircle className="w-4 h-4 text-ops-amber shrink-0" />
      <p className="font-kosugi text-[12px] text-ops-amber">
        Your admin hasn't assigned you a role yet. Some features may be limited.
      </p>
    </div>
  );
}
