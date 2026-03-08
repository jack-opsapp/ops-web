"use client";

import { useState, useEffect, useRef } from "react";
import {
  Check,
  Loader2,
  Save,
  Moon,
  Sun,
  Eye,
  Upload,
  Building2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/store/auth-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { requireSupabase, parseDateRequired } from "@/lib/supabase/helpers";
import { useImageUpload } from "@/lib/hooks/use-image-upload";
import type {
  PortalBranding,
  PortalTemplate,
  PortalThemeMode,
} from "@/lib/types/portal";
import { PORTAL_TEMPLATES } from "@/lib/portal/templates";
import { toast } from "sonner";
import { getAuth } from "firebase/auth";
import { useDictionary } from "@/i18n/client";

// ─── Query Keys ──────────────────────────────────────────────────────────────

const portalBrandingKeys = {
  all: ["portalBranding"] as const,
  detail: (companyId: string) => [...portalBrandingKeys.all, companyId] as const,
};

// ─── Client-side branding service ────────────────────────────────────────────

function mapBrandingFromDb(row: Record<string, unknown>): PortalBranding {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    logoUrl: (row.logo_url as string) ?? null,
    accentColor: (row.accent_color as string) ?? "#417394",
    template: (row.template as PortalTemplate) ?? "modern",
    themeMode: (row.theme_mode as PortalThemeMode) ?? "dark",
    fontCombo: (row.font_combo as PortalTemplate) ?? "modern",
    welcomeMessage: (row.welcome_message as string) ?? null,
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDateRequired(row.updated_at),
  };
}

async function fetchBranding(companyId: string): Promise<PortalBranding> {
  const supabase = requireSupabase();

  const { data, error } = await supabase
    .from("portal_branding")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch branding: ${error.message}`);

  if (data) return mapBrandingFromDb(data);

  // Create default row
  const { data: created, error: insertError } = await supabase
    .from("portal_branding")
    .insert({ company_id: companyId })
    .select()
    .single();

  if (insertError) throw new Error(`Failed to create default branding: ${insertError.message}`);
  return mapBrandingFromDb(created);
}

async function updateBranding(
  companyId: string,
  updates: Partial<{
    logoUrl: string | null;
    accentColor: string;
    template: PortalTemplate;
    themeMode: PortalThemeMode;
    welcomeMessage: string | null;
  }>
): Promise<PortalBranding> {
  const supabase = requireSupabase();

  const row: Record<string, unknown> = {
    company_id: companyId,
    updated_at: new Date().toISOString(),
  };

  if (updates.logoUrl !== undefined) row.logo_url = updates.logoUrl;
  if (updates.accentColor !== undefined) row.accent_color = updates.accentColor;
  if (updates.template !== undefined) row.template = updates.template;
  if (updates.themeMode !== undefined) row.theme_mode = updates.themeMode;
  if (updates.welcomeMessage !== undefined) row.welcome_message = updates.welcomeMessage;

  const { data, error } = await supabase
    .from("portal_branding")
    .upsert(row, { onConflict: "company_id" })
    .select()
    .single();

  if (error) throw new Error(`Failed to update branding: ${error.message}`);
  return mapBrandingFromDb(data);
}

// ─── Preset accent colors (derived from shared preferences store) ────────────

import { ACCENT_COLOR_VALUES } from "@/stores/preferences-store";

const ACCENT_PRESETS = Object.entries(ACCENT_COLOR_VALUES).map(([id, hex]) => ({
  label: id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
  value: hex,
}));

// ─── Template configs ────────────────────────────────────────────────────────

const TEMPLATES: { id: PortalTemplate; labelKey: string; descKey: string }[] = [
  {
    id: "modern",
    labelKey: "portalBranding.modern",
    descKey: "portalBranding.modernDesc",
  },
  {
    id: "classic",
    labelKey: "portalBranding.classic",
    descKey: "portalBranding.classicDesc",
  },
  {
    id: "bold",
    labelKey: "portalBranding.bold",
    descKey: "portalBranding.boldDesc",
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function PortalBrandingTab() {
  const { t } = useDictionary("settings");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const queryClient = useQueryClient();

  // ── Local form state ─────────────────────────────────────────────────────
  const [logoUrl, setLogoUrl] = useState("");
  const [useCompanyLogo, setUseCompanyLogo] = useState(true);
  const [accentColor, setAccentColor] = useState("#417394");
  const [template, setTemplate] = useState<PortalTemplate>("modern");
  const [themeMode, setThemeMode] = useState<PortalThemeMode>("dark");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoUpload = useImageUpload({
    onSuccess: (url) => {
      setLogoUrl(url);
      markDirty();
    },
    onError: () => toast.error("Failed to upload logo"),
  });

  // ── Fetch branding ───────────────────────────────────────────────────────
  const {
    data: branding,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: portalBrandingKeys.detail(companyId),
    queryFn: () => fetchBranding(companyId),
    enabled: !!companyId,
    staleTime: 10 * 60 * 1000,
  });

  // ── Seed form from fetched data ──────────────────────────────────────────
  useEffect(() => {
    if (branding) {
      const hasCustomLogo = !!branding.logoUrl && branding.logoUrl !== company?.logoURL;
      setUseCompanyLogo(!hasCustomLogo);
      setLogoUrl(hasCustomLogo ? branding.logoUrl! : (company?.logoURL ?? ""));
      setAccentColor(branding.accentColor);
      setTemplate(branding.template);
      setThemeMode(branding.themeMode);
      setWelcomeMessage(branding.welcomeMessage ?? "");
      setIsDirty(false);
    }
  }, [branding, company?.logoURL]);

  // ── Save mutation ────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () =>
      updateBranding(companyId, {
        logoUrl: useCompanyLogo ? null : (logoUrl.trim() || null),
        accentColor,
        template,
        themeMode,
        welcomeMessage: welcomeMessage.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: portalBrandingKeys.all,
      });
      setIsDirty(false);
      toast.success(t("portalBranding.toast.saved"));
    },
    onError: (err) => {
      toast.error(t("portalBranding.toast.saveFailed"), {
        description: err instanceof Error ? err.message : t("portalBranding.toast.tryAgain"),
      });
    },
  });

  // ── Dirty tracking helper ────────────────────────────────────────────────
  function markDirty() {
    if (!isDirty) setIsDirty(true);
  }

  async function handlePreview() {
    if (!companyId || isPreviewLoading) return;
    setIsPreviewLoading(true);

    try {
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/portal/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ companyId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create preview");
      }

      const { token: previewToken } = await res.json();
      window.open(`/portal/${previewToken}`, "_blank");
    } catch (err) {
      toast.error("Failed to open preview", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setIsPreviewLoading(false);
    }
  }

  // ── Loading state ────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-4">
          <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-3">
          <p className="font-mohave text-body text-ops-error">
            {t("portalBranding.loadFailed")}
            {error instanceof Error ? `: ${error.message}` : ""}
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Hex color validation ─────────────────────────────────────────────────
  const isValidHex = /^#[0-9A-Fa-f]{6}$/.test(accentColor);

  // ── Preview mockup (shared between inline & sidebar) ─────────────────────
  const templateConfig = PORTAL_TEMPLATES[template] ?? PORTAL_TEMPLATES.modern;
  const accent = isValidHex ? accentColor : "#417394";
  const isDark = themeMode === "dark";

  const previewBlock = (
    <Card>
      <CardHeader>
        <CardTitle>Preview</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Load template fonts for the preview */}
        {[templateConfig.headingFontImport, templateConfig.bodyFontImport]
          .filter(Boolean)
          .map((url) => (
            // eslint-disable-next-line @next/next/no-page-custom-font
            <link key={url} rel="stylesheet" href={url} />
          ))}
        <div
          className="overflow-hidden border border-border"
          style={{
            borderRadius: templateConfig.borderRadiusLg,
            background: isDark
              ? "linear-gradient(135deg, #1a1a1a 0%, #111 100%)"
              : "linear-gradient(135deg, #fafafa 0%, #f0f0f0 100%)",
          }}
        >
          {/* Mini header bar */}
          <div
            className="px-3 py-2 flex items-center gap-2"
            style={{ borderBottom: `2px solid ${accent}` }}
          >
            {(useCompanyLogo ? company?.logoURL : logoUrl) ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={(useCompanyLogo ? company?.logoURL : logoUrl) || ""}
                alt=""
                className="h-[20px] max-w-[80px] object-contain"
              />
            ) : (
              <div
                style={{
                  height: 20,
                  width: 60,
                  borderRadius: templateConfig.borderRadiusSm,
                  backgroundColor: accent,
                  opacity: 0.3,
                }}
              />
            )}
            <div className="flex-1" />
            <div className="flex gap-1.5">
              {["Home", "Projects", "Invoices"].map((tab) => (
                <span
                  key={tab}
                  style={{
                    fontFamily: templateConfig.bodyFont,
                    fontSize: "9px",
                    letterSpacing: templateConfig.letterSpacing,
                    color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)",
                  }}
                >
                  {tab}
                </span>
              ))}
            </div>
          </div>
          {/* Mini content area */}
          <div className="px-3 py-2.5 space-y-1.5">
            <div
              style={{
                fontFamily: templateConfig.headingFont,
                fontSize: "11px",
                fontWeight: templateConfig.headingWeight,
                textTransform: templateConfig.headingTransform as React.CSSProperties["textTransform"],
                letterSpacing: templateConfig.letterSpacing,
                color: isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.85)",
              }}
            >
              Welcome, Jane
            </div>
            <div className="flex gap-1.5">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="flex-1 p-1.5"
                  style={{
                    borderRadius: templateConfig.borderRadiusSm,
                    backgroundColor: isDark
                      ? "rgba(255,255,255,0.05)"
                      : "rgba(0,0,0,0.04)",
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
                  }}
                >
                  <div
                    className="h-[6px] w-[50%] mb-1"
                    style={{
                      borderRadius: templateConfig.borderRadiusSm,
                      backgroundColor: accent,
                      opacity: 0.6,
                    }}
                  />
                  <div
                    className="h-[4px] w-[70%]"
                    style={{
                      borderRadius: templateConfig.borderRadiusSm,
                      backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
                    }}
                  />
                </div>
              ))}
            </div>
            <div
              className="h-[24px] flex items-center justify-center"
              style={{
                borderRadius: templateConfig.borderRadius,
                backgroundColor: accent,
              }}
            >
              <span
                style={{
                  fontFamily: templateConfig.bodyFont,
                  fontSize: "8px",
                  fontWeight: templateConfig.headingWeight,
                  textTransform: templateConfig.headingTransform as React.CSSProperties["textTransform"],
                  letterSpacing: templateConfig.letterSpacing,
                  color: "#fff",
                }}
              >
                View Details
              </span>
            </div>
          </div>
        </div>
        <p className="font-kosugi text-[11px] text-text-disabled mt-1.5">
          A live mockup of your client portal. Click Preview Portal below to see the full experience.
        </p>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex gap-3 items-start">
      {/* ── Left column — settings form ─────────────────────────────────── */}
      <div className="space-y-3 max-w-[600px] flex-1 min-w-0">
      {/* ── Portal Logo ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("portalBranding.logoTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Toggle: use company logo vs custom */}
          <div className="grid grid-cols-2 gap-1">
            <button
              onClick={() => {
                setUseCompanyLogo(true);
                setLogoUrl(company?.logoURL ?? "");
                markDirty();
              }}
              className={cn(
                "flex items-center gap-[6px] px-1.5 py-[10px] rounded border transition-all text-left",
                useCompanyLogo
                  ? "bg-ops-accent-muted border-ops-accent"
                  : "bg-background-input border-border hover:border-border-medium"
              )}
            >
              <Building2 className={cn("w-[16px] h-[16px] shrink-0", useCompanyLogo ? "text-ops-accent" : "text-text-tertiary")} />
              <span className={cn("font-mohave text-body-sm", useCompanyLogo ? "text-ops-accent" : "text-text-secondary")}>
                Company Logo
              </span>
            </button>
            <button
              onClick={() => {
                setUseCompanyLogo(false);
                if (logoUrl === company?.logoURL) setLogoUrl("");
                markDirty();
              }}
              className={cn(
                "flex items-center gap-[6px] px-1.5 py-[10px] rounded border transition-all text-left",
                !useCompanyLogo
                  ? "bg-ops-accent-muted border-ops-accent"
                  : "bg-background-input border-border hover:border-border-medium"
              )}
            >
              <Upload className={cn("w-[16px] h-[16px] shrink-0", !useCompanyLogo ? "text-ops-accent" : "text-text-tertiary")} />
              <span className={cn("font-mohave text-body-sm", !useCompanyLogo ? "text-ops-accent" : "text-text-secondary")}>
                Custom Logo
              </span>
            </button>
          </div>

          {/* Logo preview / upload area */}
          {useCompanyLogo ? (
            <div className="p-2 rounded border border-border bg-background-input flex items-center gap-2 min-h-[64px]">
              {company?.logoURL ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={company.logoURL}
                    alt="Company logo"
                    className="max-h-[48px] max-w-[120px] object-contain"
                  />
                  <span className="font-kosugi text-[11px] text-text-disabled">
                    Using your company logo
                  </span>
                </>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Building2 className="w-[20px] h-[20px] text-text-disabled" />
                  <span className="font-kosugi text-[11px] text-text-disabled">
                    No company logo set — upload one in Company Details
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div
                className={cn(
                  "relative rounded-lg border-2 border-dashed border-border p-3 flex items-center gap-2 cursor-pointer",
                  "hover:border-ops-accent transition-colors group",
                  logoUpload.isUploading && "pointer-events-none"
                )}
                onClick={() => logoInputRef.current?.click()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) logoUpload.selectFile(file);
                }}
                onDragOver={(e) => e.preventDefault()}
              >
                {logoUrl ? (
                  <div className="flex items-center gap-2 w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUpload.preview || logoUrl}
                      alt="Portal logo"
                      className="max-h-[48px] max-w-[120px] object-contain"
                    />
                    {logoUpload.isUploading ? (
                      <Loader2 className="w-[16px] h-[16px] text-ops-accent animate-spin" />
                    ) : (
                      <span className="font-kosugi text-[11px] text-text-disabled flex-1">
                        Click or drag to replace
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setLogoUrl("");
                        logoUpload.clearPreview();
                        markDirty();
                      }}
                      className="w-[20px] h-[20px] rounded-full bg-[rgba(255,255,255,0.1)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-[12px] h-[12px] text-text-tertiary" />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-[4px] w-full py-2 text-text-disabled group-hover:text-text-tertiary transition-colors">
                    <Upload className="w-[20px] h-[20px]" />
                    <span className="font-kosugi text-[11px]">
                      Click or drag to upload logo
                    </span>
                  </div>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) logoUpload.selectFile(file);
                  }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Accent Color ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("portalBranding.accentTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Preset swatches — grid of larger color chips */}
          <div className="grid grid-cols-4 gap-1.5">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => {
                  setAccentColor(preset.value);
                  markDirty();
                }}
                className={cn(
                  "relative flex flex-col items-center gap-1 py-1.5 rounded-lg border transition-all",
                  accentColor === preset.value
                    ? "border-[rgba(255,255,255,0.4)] bg-[rgba(255,255,255,0.06)]"
                    : "border-border hover:border-border-medium"
                )}
              >
                <span
                  className="w-[32px] h-[32px] rounded-lg border border-[rgba(255,255,255,0.15)]"
                  style={{ backgroundColor: preset.value }}
                />
                <span className="font-kosugi text-[10px] text-text-tertiary leading-tight">
                  {preset.label}
                </span>
                {accentColor === preset.value && (
                  <div className="absolute top-1 right-1 w-[14px] h-[14px] rounded-full bg-white/20 flex items-center justify-center">
                    <Check className="w-[10px] h-[10px] text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Custom hex input */}
          <div className="flex items-center gap-1.5 pt-0.5">
            <div
              className="w-[32px] h-[32px] rounded-lg border border-[rgba(255,255,255,0.15)] shrink-0"
              style={{ backgroundColor: isValidHex ? accentColor : "#333" }}
            />
            <Input
              value={accentColor}
              onChange={(e) => {
                setAccentColor(e.target.value);
                markDirty();
              }}
              placeholder={t("portalBranding.colorPlaceholder")}
              className="w-[140px] font-mono"
              error={!isValidHex && accentColor.length > 0 ? t("portalBranding.invalidColor") : undefined}
            />
            <span className="font-kosugi text-[10px] text-text-disabled">
              Custom
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Template Selector ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("portalBranding.templateTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.id}
                onClick={() => {
                  setTemplate(tmpl.id);
                  markDirty();
                }}
                className={cn(
                  "w-full flex items-center justify-between px-1.5 py-1 rounded border transition-all text-left",
                  template === tmpl.id
                    ? "bg-ops-accent-muted border-ops-accent"
                    : "bg-background-input border-border hover:border-border-medium"
                )}
              >
                <div>
                  <p className="font-mohave text-body text-text-primary">{t(tmpl.labelKey)}</p>
                  <p className="font-kosugi text-[11px] text-text-tertiary">{t(tmpl.descKey)}</p>
                </div>
                {template === tmpl.id && (
                  <div className="w-[20px] h-[20px] rounded-full bg-ops-accent flex items-center justify-center shrink-0 ml-1">
                    <Check className="w-[12px] h-[12px] text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Theme Mode ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("portalBranding.themeTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-1">
            {([
              { id: "light" as PortalThemeMode, label: t("portalBranding.themeLight"), icon: Sun },
              { id: "dark" as PortalThemeMode, label: t("portalBranding.themeDark"), icon: Moon },
            ]).map((mode) => (
              <button
                key={mode.id}
                onClick={() => {
                  setThemeMode(mode.id);
                  markDirty();
                }}
                className={cn(
                  "flex flex-col items-center gap-[6px] py-1.5 rounded border transition-all",
                  themeMode === mode.id
                    ? "bg-ops-accent-muted border-ops-accent"
                    : "bg-background-input border-border hover:border-border-medium"
                )}
              >
                <mode.icon
                  className={cn(
                    "w-[20px] h-[20px]",
                    themeMode === mode.id ? "text-ops-accent" : "text-text-tertiary"
                  )}
                />
                <span
                  className={cn(
                    "font-mohave text-body-sm",
                    themeMode === mode.id ? "text-ops-accent" : "text-text-secondary"
                  )}
                >
                  {mode.label}
                </span>
              </button>
            ))}
          </div>
          <p className="font-kosugi text-[11px] text-text-disabled mt-1">
            {t("portalBranding.themeHelper")}
          </p>
        </CardContent>
      </Card>

      {/* ── Welcome Message ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("portalBranding.welcomeTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={welcomeMessage}
            onChange={(e) => {
              setWelcomeMessage(e.target.value);
              markDirty();
            }}
            placeholder={t("portalBranding.welcomePlaceholder")}
            helperText={t("portalBranding.welcomeHelper")}
            className="min-h-[100px]"
          />
        </CardContent>
      </Card>

      {/* ── Inline Preview (visible below xl) ───────────────────────────── */}
      <div className="xl:hidden">
        {previewBlock}
      </div>

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-1">
        <p className="font-kosugi text-[11px] text-text-disabled">
          {isDirty
            ? t("portalBranding.unsavedChanges")
            : t("portalBranding.allSaved")}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            onClick={handlePreview}
            disabled={isPreviewLoading}
            loading={isPreviewLoading}
          >
            <Eye className="w-[16px] h-[16px]" />
            Preview Portal
          </Button>
          <Button
            variant="primary"
            onClick={() => saveMutation.mutate()}
            disabled={!isDirty || saveMutation.isPending || !isValidHex}
            loading={saveMutation.isPending}
          >
            <Save className="w-[16px] h-[16px]" />
            {t("portalBranding.saveBranding")}
          </Button>
        </div>
      </div>
      </div>

      {/* ── Right column — sticky preview (visible at xl+) ─────────────── */}
      <div className="hidden xl:block w-[340px] shrink-0 sticky top-3">
        {previewBlock}
      </div>
    </div>
  );
}
