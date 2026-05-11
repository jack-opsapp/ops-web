"use client";

import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { interpolate } from "@/lib/i18n/interpolate";
import { LockoutShell } from "../lockout-shell";
import { PricingRow } from "../pricing-row";
import { useLockoutDate } from "../hooks/use-lockout-date";

export interface ExpiredAdminStateProps {
  variant: "page" | "overlay";
}

export function ExpiredAdminState({ variant }: ExpiredAdminStateProps) {
  const { t } = useDictionary("auth");
  const company = useAuthStore((s) => s.company);
  const date = useLockoutDate(
    company
      ? {
          subscriptionPlan: company.subscriptionPlan,
          trialEndDate: company.trialEndDate,
          subscriptionEnd: company.subscriptionEnd,
        }
      : null
  );

  const displayDate = date
    ? new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(date)
    : null;
  const isoDate = date ? date.toISOString().slice(0, 10) : null;

  const tagLabel = displayDate
    ? interpolate(t("lockout.expiredAdmin.tagWithDate"), { date: displayDate })
    : t("lockout.expiredAdmin.tag");
  const body = displayDate
    ? interpolate(t("lockout.expiredAdmin.bodyWithDate"), { date: displayDate })
    : t("lockout.expiredAdmin.body");
  const fingerprint = isoDate
    ? interpolate(t("lockout.expiredAdmin.fingerprintWithDate"), { date: isoDate })
    : t("lockout.expiredAdmin.fingerprint");

  return (
    <LockoutShell
      variant={variant}
      tag={{ tone: "rose", label: tagLabel }}
      heading={t("lockout.expiredAdmin.heading")}
      body={body}
      sectionLabel={t("lockout.expiredAdmin.sectionLabel")}
      fingerprint={fingerprint}
      showSwitchAccount={false}
    >
      <PricingRow companyId={company?.id} />
      <p className="font-mohave text-[13px] text-text-3 mt-3">
        {t("lockout.expiredAdmin.guarantee")}
      </p>
    </LockoutShell>
  );
}
