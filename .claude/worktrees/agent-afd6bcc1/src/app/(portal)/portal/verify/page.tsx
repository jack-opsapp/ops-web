"use client";

import { AlertCircle } from "lucide-react";
import { useDictionary } from "@/i18n/client";

/**
 * Fallback page when a user navigates to a protected portal route
 * without a valid session. Middleware redirects here.
 */
export default function PortalVerifyPage() {
  const { t } = useDictionary("portal");

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--portal-bg, #0A0A0A)" }}
    >
      <div
        className="w-full max-w-md rounded-xl p-8 text-center"
        style={{
          backgroundColor: "var(--portal-card, #191919)",
          border: "1px solid var(--portal-border, rgba(255,255,255,0.08))",
        }}
      >
        <AlertCircle
          className="w-10 h-10 mx-auto mb-3"
          style={{ color: "var(--portal-warning, #C4A868)" }}
        />
        <h1
          className="text-lg font-semibold mb-2"
          style={{ color: "var(--portal-text, #E5E5E5)" }}
        >
          {t("verify.title")}
        </h1>
        <p
          className="text-sm"
          style={{ color: "var(--portal-text-secondary, #A7A7A7)" }}
        >
          {t("verify.message")}
        </p>
      </div>
    </div>
  );
}
