"use client";

import { AlertCircle, Clock } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { OpsLockup } from "@/components/brand";

/**
 * Session expired fallback page.
 * Shown when middleware redirects a user without a valid session.
 * Uses the same visual treatment as the magic link landing page
 * but with "Your session has expired" messaging.
 */
export default function PortalVerifyPage() {
  const { t } = useDictionary("portal");

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--portal-bg, #0A0A0A)" }}
    >
      <div
        className="w-full max-w-md p-8 text-center"
        style={{
          backgroundColor: "var(--portal-card, #191919)",
          border: "1px solid var(--portal-border, rgba(255,255,255,0.08))",
          borderRadius: "var(--portal-radius-lg, 12px)",
        }}
      >
        {/* Icon */}
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{
            backgroundColor: "color-mix(in srgb, var(--portal-warning, #C4A868) 15%, transparent)",
          }}
        >
          <Clock
            className="w-7 h-7"
            style={{ color: "var(--portal-warning, #C4A868)" }}
          />
        </div>

        {/* Title */}
        <h1
          className="text-lg font-semibold mb-2"
          style={{
            color: "var(--portal-text, #EDEDED)",
            fontFamily: "var(--portal-heading-font, inherit)",
            fontWeight: "var(--portal-heading-weight, 600)",
          }}
        >
          {t("verify.title")}
        </h1>

        {/* Message */}
        <p
          className="text-sm leading-relaxed mb-4"
          style={{ color: "var(--portal-text-secondary, #B5B5B5)" }}
        >
          {t("verify.message")}
        </p>

        {/* Divider */}
        <div
          className="my-5"
          style={{
            borderTop: "1px solid var(--portal-border, rgba(255,255,255,0.08))",
          }}
        />

        {/* Contact provider hint */}
        <div className="flex items-start gap-2 text-left">
          <AlertCircle
            className="w-4 h-4 shrink-0 mt-0.5"
            style={{ color: "var(--portal-text-tertiary, #6B6B6B)" }}
          />
          <div>
            <p
              className="text-xs font-medium mb-0.5"
              style={{ color: "var(--portal-text-secondary, #B5B5B5)" }}
            >
              {t("verify.subtitle")}
            </p>
            <p
              className="text-xs"
              style={{ color: "var(--portal-text-tertiary, #6B6B6B)" }}
            >
              {t("verify.contactProvider")}
            </p>
          </div>
        </div>

        {/* Powered by OPS */}
        <div
          className="flex items-center justify-center gap-2 text-[10px] mt-8 tracking-wider uppercase"
          style={{
            color: "var(--portal-text-secondary, #B5B5B5)",
            opacity: 0.5,
          }}
        >
          <span>{t("landing.poweredBy")}</span>
          <OpsLockup orientation="horizontal" className="h-2.5 w-auto" />
        </div>
      </div>
    </div>
  );
}
