"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, AlertCircle, Mail } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { PORTAL_TEMPLATES } from "@/lib/portal/templates";
import type { PortalTemplate, PortalThemeMode } from "@/lib/types/portal";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TokenBranding {
  logoUrl: string | null;
  accentColor: string;
  template: PortalTemplate;
  themeMode: PortalThemeMode;
  companyName: string;
}

// ─── Theme generation ─────────────────────────────────────────────────────────

function generateBrandingVars(branding: TokenBranding): Record<string, string> {
  const templateConfig = PORTAL_TEMPLATES[branding.template] ?? PORTAL_TEMPLATES.modern;
  const isDark = branding.themeMode === "dark";
  const accent = branding.accentColor || "#417394";

  return {
    "--portal-bg": isDark ? "#0A0A0A" : "#FAFAFA",
    "--portal-card": isDark ? "#191919" : "#FFFFFF",
    "--portal-text": isDark ? "#E5E5E5" : "#1A1A1A",
    "--portal-text-secondary": isDark ? "#A7A7A7" : "#666666",
    "--portal-text-tertiary": isDark ? "#6B6B6B" : "#999999",
    "--portal-accent": accent,
    "--portal-accent-text": "#FFFFFF",
    "--portal-border": isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
    "--portal-error": "#B58289",
    "--portal-warning": "#C4A868",
    "--portal-success": "#9DB582",
    "--portal-heading-font": templateConfig.headingFont,
    "--portal-body-font": templateConfig.bodyFont,
    "--portal-radius": templateConfig.borderRadius,
    "--portal-radius-sm": templateConfig.borderRadiusSm,
    "--portal-radius-lg": templateConfig.borderRadiusLg,
    "--portal-heading-weight": String(templateConfig.headingWeight),
    "--portal-heading-transform": templateConfig.headingTransform,
    "--portal-letter-spacing": templateConfig.letterSpacing,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MagicLinkLandingPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  const { t } = useDictionary("portal");

  const [status, setStatus] = useState<"loading" | "valid" | "expired" | "error">("loading");
  const [isPreview, setIsPreview] = useState(false);
  const [branding, setBranding] = useState<TokenBranding | null>(null);
  const [email, setEmail] = useState("");
  const autoVerifyCalledRef = useRef(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Generate CSS vars from branding
  const brandingVars = useMemo(() => {
    if (!branding) return {};
    return generateBrandingVars(branding);
  }, [branding]);

  // Load template fonts
  const fontUrls = useMemo(() => {
    if (!branding) return [];
    const templateConfig = PORTAL_TEMPLATES[branding.template] ?? PORTAL_TEMPLATES.modern;
    return [templateConfig.headingFontImport, templateConfig.bodyFontImport].filter(Boolean) as string[];
  }, [branding]);

  // Validate token on mount — get branding BEFORE rendering form
  useEffect(() => {
    async function validateToken() {
      try {
        const res = await fetch(`/api/portal/auth/validate-token?token=${token}`);
        const data = await res.json();
        if (data.valid) {
          // Extract branding from response
          if (data.branding) {
            setBranding({
              logoUrl: data.branding.logoUrl ?? null,
              accentColor: data.branding.accentColor ?? "#417394",
              template: data.branding.template ?? "modern",
              themeMode: data.branding.themeMode ?? "dark",
              companyName: data.branding.companyName ?? "",
            });
          }
          setStatus("valid");
          if (data.isPreview) {
            setIsPreview(true);
          }
        } else if (data.reason === "expired") {
          // Still try to use branding for error state
          if (data.branding) {
            setBranding({
              logoUrl: data.branding.logoUrl ?? null,
              accentColor: data.branding.accentColor ?? "#417394",
              template: data.branding.template ?? "modern",
              themeMode: data.branding.themeMode ?? "dark",
              companyName: data.branding.companyName ?? "",
            });
          }
          setStatus("expired");
        } else {
          if (data.branding) {
            setBranding({
              logoUrl: data.branding.logoUrl ?? null,
              accentColor: data.branding.accentColor ?? "#417394",
              template: data.branding.template ?? "modern",
              themeMode: data.branding.themeMode ?? "dark",
              companyName: data.branding.companyName ?? "",
            });
          }
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    }
    validateToken();
  }, [token]);

  // Auto-verify preview tokens (no email needed)
  useEffect(() => {
    if (!isPreview || status !== "valid") return;
    if (autoVerifyCalledRef.current) return;
    autoVerifyCalledRef.current = true;

    async function autoVerify() {
      setIsVerifying(true);
      try {
        const res = await fetch("/api/portal/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, email: "preview@ops.app" }),
        });

        if (res.ok) {
          router.push("/portal/home");
        } else {
          setStatus("error");
          setErrorMessage(t("landing.previewError"));
        }
      } catch {
        setStatus("error");
        setErrorMessage(t("landing.genericError"));
      } finally {
        setIsVerifying(false);
      }
    }
    autoVerify();
  }, [isPreview, status, token, router, t]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setIsVerifying(true);
    setErrorMessage("");

    try {
      const res = await fetch("/api/portal/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email: email.trim() }),
      });

      if (res.ok) {
        router.push("/portal/home");
      } else {
        const data = await res.json();
        setErrorMessage(data.error ?? t("landing.verifyFailed"));
      }
    } catch {
      setErrorMessage(t("landing.genericError"));
    } finally {
      setIsVerifying(false);
    }
  }

  // Resolve colors with branding or defaults
  const bg = brandingVars["--portal-bg"] || "#0A0A0A";
  const card = brandingVars["--portal-card"] || "#191919";
  const text = brandingVars["--portal-text"] || "#E5E5E5";
  const textSecondary = brandingVars["--portal-text-secondary"] || "#A7A7A7";
  const accent = brandingVars["--portal-accent"] || "#417394";
  const border = brandingVars["--portal-border"] || "rgba(255,255,255,0.08)";
  const warning = brandingVars["--portal-warning"] || "#C4A868";
  const errorColor = brandingVars["--portal-error"] || "#B58289";
  const headingFont = brandingVars["--portal-heading-font"] || "inherit";
  const radius = brandingVars["--portal-radius-lg"] || "12px";

  return (
    <>
      {/* Load template fonts */}
      {fontUrls.map((url) => (
        // eslint-disable-next-line @next/next/no-page-custom-font
        <link key={url} rel="stylesheet" href={url} />
      ))}

      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{ backgroundColor: bg, ...brandingVars } as React.CSSProperties}
      >
        <div
          className="w-full max-w-md p-8"
          style={{
            backgroundColor: card,
            border: `1px solid ${border}`,
            borderRadius: radius,
          }}
        >
          {/* Loading */}
          {status === "loading" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: accent }} />
              <p style={{ color: textSecondary }} className="text-sm">
                {t("landing.validating")}
              </p>
            </div>
          )}

          {/* Preview: auto-verifying */}
          {status === "valid" && isPreview && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: accent }} />
              <p style={{ color: textSecondary }} className="text-sm">
                {t("landing.loadingPreview")}
              </p>
            </div>
          )}

          {/* Token valid — company-branded email form */}
          {status === "valid" && !isPreview && (
            <>
              <div className="flex flex-col items-center gap-3 mb-6">
                {/* Company logo */}
                {branding?.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={branding.logoUrl}
                    alt={branding.companyName || ""}
                    className="max-h-[48px] max-w-[180px] object-contain mb-1"
                  />
                ) : (
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: accent }}
                  >
                    <Mail className="w-6 h-6 text-white" />
                  </div>
                )}

                {/* Company name */}
                {branding?.companyName && (
                  <p
                    className="text-xs font-medium uppercase tracking-wider"
                    style={{ color: textSecondary }}
                  >
                    {branding.companyName}
                  </p>
                )}

                <h1
                  className="text-xl font-semibold text-center"
                  style={{ color: text, fontFamily: headingFont }}
                >
                  {t("landing.verifyTitle")}
                </h1>
                <p
                  className="text-sm text-center"
                  style={{ color: textSecondary }}
                >
                  {t("landing.verifyDesc")}
                </p>
              </div>

              <form onSubmit={handleVerify} className="space-y-4">
                <div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("landing.emailPlaceholder")}
                    required
                    autoFocus
                    className="w-full px-4 py-3 text-sm outline-none transition-colors"
                    style={{
                      backgroundColor: bg,
                      color: text,
                      border: `1px solid ${border}`,
                      borderRadius: brandingVars["--portal-radius"] || "8px",
                    }}
                  />
                </div>

                {errorMessage && (
                  <p className="text-sm flex items-center gap-1.5" style={{ color: errorColor }}>
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {errorMessage}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isVerifying || !email.trim()}
                  className="w-full py-3 text-sm font-medium text-white transition-opacity disabled:opacity-50"
                  style={{
                    backgroundColor: accent,
                    borderRadius: brandingVars["--portal-radius"] || "8px",
                  }}
                >
                  {isVerifying ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  ) : (
                    t("landing.accessPortal")
                  )}
                </button>
              </form>
            </>
          )}

          {/* Token expired */}
          {status === "expired" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              {branding?.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.logoUrl}
                  alt=""
                  className="max-h-[40px] max-w-[160px] object-contain mb-2"
                />
              )}
              <AlertCircle className="w-10 h-10" style={{ color: warning }} />
              <h1
                className="text-lg font-semibold"
                style={{ color: text, fontFamily: headingFont }}
              >
                {t("landing.expiredTitle")}
              </h1>
              <p className="text-sm" style={{ color: textSecondary }}>
                {t("landing.expiredDesc")}
              </p>
            </div>
          )}

          {/* Token invalid */}
          {status === "error" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              {branding?.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.logoUrl}
                  alt=""
                  className="max-h-[40px] max-w-[160px] object-contain mb-2"
                />
              )}
              <AlertCircle className="w-10 h-10" style={{ color: errorColor }} />
              <h1
                className="text-lg font-semibold"
                style={{ color: text, fontFamily: headingFont }}
              >
                {t("landing.invalidTitle")}
              </h1>
              <p className="text-sm" style={{ color: textSecondary }}>
                {errorMessage || t("landing.invalidDesc")}
              </p>
            </div>
          )}

          {/* Powered by OPS */}
          <p
            className="text-[10px] text-center mt-6 tracking-wider uppercase"
            style={{ color: textSecondary, opacity: 0.5 }}
          >
            {t("landing.poweredBy")}
          </p>
        </div>
      </div>
    </>
  );
}
