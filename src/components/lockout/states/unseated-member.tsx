"use client";

import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store/auth-store";
import { LockoutShell } from "../lockout-shell";
import { AdminTag } from "../admin-tag";
import { RequestButton } from "../request-button";
import { useAdminNames } from "../hooks/use-admin-names";

export interface UnseatedMemberStateProps {
  variant: "page" | "overlay";
}

export function UnseatedMemberState({ variant }: UnseatedMemberStateProps) {
  const { t } = useDictionary("auth");
  const company = useAuthStore((s) => s.company);
  const currentUser = useAuthStore((s) => s.currentUser);
  const admins = useAdminNames(company?.adminIds);

  const noAdmins = (company?.adminIds?.length ?? 0) === 0;

  return (
    <LockoutShell
      variant={variant}
      tag={{ tone: "tan", label: t("lockout.unseatedMember.tag") }}
      heading={t("lockout.unseatedMember.heading")}
      body={t("lockout.unseatedMember.body")}
      sectionLabel={t("lockout.unseatedMember.sectionLabel")}
      fingerprint={t("lockout.unseatedMember.fingerprint")}
    >
      {noAdmins ? (
        <>
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
            <span className="text-text-mute">SYS :: </span>
            {t("lockout.shared.noAdmins").toUpperCase()}
          </p>
          <a href="mailto:support@opsapp.co">
            <Button variant="primary" size="sm" className="w-full">
              {t("lockout.shared.noAdminsCta")}
            </Button>
          </a>
          <p className="mt-3 font-mohave text-[13px] text-text-3">
            {t("lockout.shared.noAdminsBody")}
          </p>
        </>
      ) : (
        <>
          <AdminTag admins={admins} />
          <RequestButton
            reason="unseated"
            userId={currentUser?.id ?? ""}
            adminIds={company?.adminIds ?? []}
            ctaKey="lockout.unseatedMember.cta"
          />
          <p className="mt-3 font-mohave text-[13px] text-text-3">
            {t("lockout.unseatedMember.explainer")}
          </p>
        </>
      )}
    </LockoutShell>
  );
}
