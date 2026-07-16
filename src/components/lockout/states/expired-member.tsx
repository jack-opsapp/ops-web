"use client";

import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { interpolate } from "@/lib/i18n/interpolate";
import { LockoutShell } from "../lockout-shell";
import { AdminTag } from "../admin-tag";
import { RequestButton } from "../request-button";
import { Button } from "@/components/ui/button";
import { useAdminNames } from "../hooks/use-admin-names";
import { useLockoutDate } from "../hooks/use-lockout-date";

export interface ExpiredMemberStateProps {
  variant: "page" | "overlay";
}

export function ExpiredMemberState({ variant }: ExpiredMemberStateProps) {
  const { t } = useDictionary("auth");
  const company = useAuthStore((s) => s.company);
  const currentUser = useAuthStore((s) => s.currentUser);
  const admins = useAdminNames(company?.adminIds);
  const date = useLockoutDate(
    company
      ? {
          subscriptionPlan: company.subscriptionPlan,
          trialEndDate: company.trialEndDate,
          subscriptionEnd: company.subscriptionEnd,
        }
      : null
  );
  const isoDate = date ? date.toISOString().slice(0, 10) : null;

  const fingerprint = isoDate
    ? interpolate(t("lockout.expiredMember.fingerprintWithDate"), {
        date: isoDate,
      })
    : t("lockout.expiredMember.fingerprint");

  const noAdmins = (company?.adminIds?.length ?? 0) === 0;

  return (
    <LockoutShell
      variant={variant}
      tag={{ tone: "rose", label: t("lockout.expiredMember.tag") }}
      heading={t("lockout.expiredMember.heading")}
      body={t("lockout.expiredMember.body")}
      sectionLabel={t("lockout.expiredMember.sectionLabel")}
      fingerprint={fingerprint}
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
            reason="subscription_expired"
            userId={currentUser?.id ?? ""}
            adminIds={company?.adminIds ?? []}
            ctaKey="lockout.expiredMember.cta"
          />
          <p className="mt-3 font-mohave text-[13px] text-text-3">
            {t("lockout.expiredMember.explainer")}
          </p>
        </>
      )}
    </LockoutShell>
  );
}
