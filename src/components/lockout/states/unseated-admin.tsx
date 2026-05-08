"use client";

import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { LockoutShell } from "../lockout-shell";

export interface UnseatedAdminStateProps {
  variant: "page" | "overlay";
}

export function UnseatedAdminState({ variant }: UnseatedAdminStateProps) {
  const { t } = useDictionary("auth");
  return (
    <LockoutShell
      variant={variant}
      tag={{ tone: "tan", label: t("lockout.unseatedAdmin.tag") }}
      heading={t("lockout.unseatedAdmin.heading")}
      body={t("lockout.unseatedAdmin.body")}
      sectionLabel={t("lockout.unseatedAdmin.sectionLabel")}
      fingerprint={t("lockout.unseatedAdmin.fingerprint")}
      showSwitchAccount={false}
    >
      {/* Hard navigation — clicking should unmount the lockout overlay
          and let the (dashboard)/team page take over (where the overlay
          is exempted for admins). */}
      <a href="/team" className="block">
        <Button variant="primary" size="sm" className="w-full">
          {t("lockout.unseatedAdmin.cta")}
        </Button>
      </a>
      <p className="font-mohave text-[13px] text-text-3 mt-3">
        {t("lockout.unseatedAdmin.explainer")}
      </p>
    </LockoutShell>
  );
}
