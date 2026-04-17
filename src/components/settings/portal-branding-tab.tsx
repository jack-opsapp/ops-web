"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Check,
  Loader2,
  Save,
  Moon,
  Sun,
  Eye,
  RotateCcw,
  FileText,
  Receipt,
  FolderOpen,
  Home,
  MessageSquare,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/store/auth-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { requireSupabase, parseDateRequired } from "@/lib/supabase/helpers";
import { extractLogoColors } from "@/lib/utils/extract-logo-colors";
import type {
  PortalBranding,
  PortalTemplate,
  PortalThemeMode,
} from "@/lib/types/portal";
import { PORTAL_TEMPLATES } from "@/lib/portal/templates";
import { toast } from "sonner";
import { getAuth } from "firebase/auth";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";

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
    showQuantities: row.show_quantities as boolean | null ?? null,
    showUnitPrices: row.show_unit_prices as boolean | null ?? null,
    showLineTotals: row.show_line_totals as boolean | null ?? null,
    showDescriptions: row.show_descriptions as boolean | null ?? null,
    showTax: row.show_tax as boolean | null ?? null,
    showDiscount: row.show_discount as boolean | null ?? null,
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
    showQuantities: boolean | null;
    showUnitPrices: boolean | null;
    showLineTotals: boolean | null;
    showDescriptions: boolean | null;
    showTax: boolean | null;
    showDiscount: boolean | null;
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
  if (updates.showQuantities !== undefined) row.show_quantities = updates.showQuantities;
  if (updates.showUnitPrices !== undefined) row.show_unit_prices = updates.showUnitPrices;
  if (updates.showLineTotals !== undefined) row.show_line_totals = updates.showLineTotals;
  if (updates.showDescriptions !== undefined) row.show_descriptions = updates.showDescriptions;
  if (updates.showTax !== undefined) row.show_tax = updates.showTax;
  if (updates.showDiscount !== undefined) row.show_discount = updates.showDiscount;

  const { data, error } = await supabase
    .from("portal_branding")
    .upsert(row, { onConflict: "company_id" })
    .select()
    .single();

  if (error) throw new Error(`Failed to update branding: ${error.message}`);
  return mapBrandingFromDb(data);
}

// ─── Preset accent colors (centralized palette) ─────────────────────────────

import { ACCENT_COLORS } from "@/lib/data/curated-colors";

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
  const can = usePermissionStore((s) => s.can);
  const canManage = can("portal.manage_branding");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const queryClient = useQueryClient();

  // ── Local form state ─────────────────────────────────────────────────────
  const [accentColor, setAccentColor] = useState("#417394");
  const [template, setTemplate] = useState<PortalTemplate>("modern");
  const [themeMode, setThemeMode] = useState<PortalThemeMode>("dark");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  // Document visibility overrides (null = use template, true = always show, false = always hide)
  const [showQuantities, setShowQuantities] = useState<boolean | null>(null);
  const [showUnitPrices, setShowUnitPrices] = useState<boolean | null>(null);
  const [showLineTotals, setShowLineTotals] = useState<boolean | null>(null);
  const [showDescriptions, setShowDescriptions] = useState<boolean | null>(null);
  const [showTax, setShowTax] = useState<boolean | null>(null);
  const [showDiscount, setShowDiscount] = useState<boolean | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  // Logo-extracted suggested colors
  const [suggestedColors, setSuggestedColors] = useState<string[]>([]);

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
  const seedFromBranding = useCallback((b: PortalBranding) => {
    setAccentColor(b.accentColor);
    setTemplate(b.template);
    setThemeMode(b.themeMode);
    setWelcomeMessage(b.welcomeMessage ?? "");
    setShowQuantities(b.showQuantities ?? null);
    setShowUnitPrices(b.showUnitPrices ?? null);
    setShowLineTotals(b.showLineTotals ?? null);
    setShowDescriptions(b.showDescriptions ?? null);
    setShowTax(b.showTax ?? null);
    setShowDiscount(b.showDiscount ?? null);
    setIsDirty(false);
  }, []);

  useEffect(() => {
    if (branding) seedFromBranding(branding);
  }, [branding, seedFromBranding]);

  // ── Extract suggested colors from company logo ─────────────────────────
  useEffect(() => {
    if (company?.logoURL) {
      extractLogoColors(company.logoURL, 5).then(setSuggestedColors);
    }
  }, [company?.logoURL]);

  // ── Discard handler ────────────────────────────────────────────────────
  function handleDiscard() {
    if (branding) seedFromBranding(branding);
  }

  // ── Save mutation ────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () =>
      updateBranding(companyId, {
        logoUrl: null,
        accentColor,
        template,
        themeMode,
        welcomeMessage: welcomeMessage.trim() || null,
        showQuantities,
        showUnitPrices,
        showLineTotals,
        showDescriptions,
        showTax,
        showDiscount,
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
  const portalBg = isDark ? "#0A0A0A" : "#FAFAFA";
  const portalCard = isDark ? "#191919" : "#FFFFFF";
  const portalText = isDark ? "#E5E5E5" : "#1A1A1A";
  const portalTextSec = isDark ? "#A7A7A7" : "#6B7280";
  const portalTextTer = isDark ? "#6B7280" : "#9CA3AF";
  const portalBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const currentLogoUrl = company?.logoURL ?? null;

  const previewBlock = (
    <Card>
      <CardHeader>
        <CardTitle>Preview</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Load template fonts */}
        {[templateConfig.headingFontImport, templateConfig.bodyFontImport]
          .filter(Boolean)
          .map((url) => (
            // eslint-disable-next-line @next/next/no-page-custom-font
            <link key={url} rel="stylesheet" href={url} />
          ))}
        <div
          className="overflow-hidden border border-border"
          style={{ borderRadius: templateConfig.borderRadiusLg, background: portalBg }}
        >
          {/* ── Header ── */}
          <div
            className="px-3 py-2 flex items-center gap-2"
            style={{
              backgroundColor: templateConfig.headerStyle === "accent" ? accent : portalCard,
              borderBottom: templateConfig.headerStyle === "accent" ? "none" : templateConfig.headerBorder.replace("var(--portal-border)", portalBorder).replace("var(--portal-accent)", accent),
            }}
          >
            {currentLogoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={currentLogoUrl} alt="" className="h-[16px] max-w-[70px] object-contain" />
            ) : (
              <Building2 style={{ width: 14, height: 14, color: templateConfig.headerStyle === "accent" ? "#fff" : portalTextTer }} />
            )}
            <div className="flex-1" />
            <div className="flex gap-2 items-center">
              {[
                { icon: Home, label: "Home", active: true },
                { icon: FolderOpen, label: "Project", active: false },
                { icon: MessageSquare, label: "Messages", active: false },
              ].map((tab) => (
                <span
                  key={tab.label}
                  className="relative flex items-center gap-0.5"
                  style={{
                    fontFamily: templateConfig.bodyFont,
                    fontSize: "8px",
                    letterSpacing: templateConfig.letterSpacing,
                    color: tab.active
                      ? (templateConfig.headerStyle === "accent" ? "#fff" : accent)
                      : (templateConfig.headerStyle === "accent" ? "rgba(255,255,255,0.6)" : portalTextTer),
                  }}
                >
                  <tab.icon style={{ width: 8, height: 8 }} />
                  {tab.label}
                  {tab.active && (
                    <span className="absolute -bottom-[5px] left-0 right-0 h-[1.5px]" style={{ backgroundColor: templateConfig.headerStyle === "accent" ? "#fff" : accent }} />
                  )}
                </span>
              ))}
            </div>
          </div>

          {/* ── Content ── */}
          <div className="px-3 py-2.5 space-y-2">
            {/* Greeting */}
            <div>
              <div
                style={{
                  fontFamily: templateConfig.headingFont,
                  fontSize: "11px",
                  fontWeight: templateConfig.headingWeight,
                  textTransform: templateConfig.headingTransform as React.CSSProperties["textTransform"],
                  letterSpacing: templateConfig.letterSpacing,
                  color: portalText,
                }}
              >
                Hi, Jane
              </div>
              {welcomeMessage && (
                <div style={{ fontFamily: templateConfig.bodyFont, fontSize: "8px", color: portalTextSec, marginTop: 1 }}>
                  {welcomeMessage.length > 60 ? welcomeMessage.slice(0, 60) + "..." : welcomeMessage}
                </div>
              )}
            </div>

            {/* Action item */}
            <div
              className="flex items-center gap-1.5 px-2 py-1.5"
              style={{
                backgroundColor: portalCard,
                boxShadow: templateConfig.cardShadow === "none" ? undefined : templateConfig.cardShadow,
                border: templateConfig.cardBorder === "none" ? `1px solid ${portalBorder}` : templateConfig.cardBorder.replace("var(--portal-border)", portalBorder),
                borderRadius: templateConfig.borderRadiusSm,
                borderLeft: templateConfig.cardAccentEdge === "left" ? `${templateConfig.cardAccentEdgeWidth} solid ${accent}` : undefined,
              }}
            >
              <FileText style={{ width: 10, height: 10, color: accent, flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div style={{ fontFamily: templateConfig.bodyFont, fontSize: "8px", fontWeight: 500, color: portalText }}>
                  Estimate #EST-1001
                </div>
                <div style={{ fontFamily: templateConfig.bodyFont, fontSize: "7px", color: portalTextSec }}>
                  $8,750 · Aug 20
                </div>
              </div>
              {/* Status badge */}
              {templateConfig.statusStyle === "text-bold" ? (
                <span style={{ fontSize: "7px", fontWeight: 700, color: accent }}>Sent</span>
              ) : (
                <span
                  style={{
                    fontSize: "7px",
                    fontWeight: 500,
                    padding: "1px 4px",
                    borderRadius: templateConfig.statusStyle === "pill-rounded" ? "9999px" : "9999px",
                    backgroundColor: templateConfig.statusStyle === "pill-rounded" ? `${accent}22` : "transparent",
                    border: templateConfig.statusStyle === "pill-bordered" ? `1px solid ${accent}` : "none",
                    color: accent,
                  }}
                >
                  Sent
                </span>
              )}
            </div>

            {/* Project card */}
            <div
              style={{
                backgroundColor: portalCard,
                boxShadow: templateConfig.cardShadow === "none" ? undefined : templateConfig.cardShadow,
                border: templateConfig.cardBorder === "none" ? `1px solid ${portalBorder}` : templateConfig.cardBorder.replace("var(--portal-border)", portalBorder),
                borderRadius: templateConfig.borderRadius,
                borderLeft: templateConfig.cardAccentEdge === "left" ? `${templateConfig.cardAccentEdgeWidth} solid ${accent}` : undefined,
                overflow: "hidden",
              }}
            >
              {/* Hero gradient */}
              <div style={{ height: 28, background: `linear-gradient(135deg, ${accent}44 0%, ${portalBg} 100%)` }} />
              <div className="px-2 py-1.5">
                <div style={{ fontFamily: templateConfig.headingFont, fontSize: "9px", fontWeight: templateConfig.headingWeight, textTransform: templateConfig.headingTransform as React.CSSProperties["textTransform"], letterSpacing: templateConfig.letterSpacing, color: portalText }}>
                  Kitchen Renovation
                </div>
                <div style={{ fontFamily: templateConfig.bodyFont, fontSize: "7px", color: portalTextSec, marginTop: 1 }}>
                  123 Oak Street
                </div>
                {/* Progress bar */}
                <div style={{ marginTop: 4 }}>
                  <div style={{ height: templateConfig.progressBarHeight, borderRadius: templateConfig.progressBarRadius, backgroundColor: portalBorder, overflow: "hidden" }}>
                    <div style={{ width: "33%", height: "100%", backgroundColor: accent, borderRadius: templateConfig.progressBarRadius }} />
                  </div>
                  <div style={{ fontFamily: templateConfig.bodyFont, fontSize: "6px", color: portalTextTer, marginTop: 1 }}>
                    33% complete
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Bottom nav (mobile indicator) ── */}
          <div
            className="flex justify-around px-3 py-1.5"
            style={{ borderTop: `1px solid ${portalBorder}` }}
          >
            {[
              { icon: Home, active: true },
              { icon: FolderOpen, active: false },
              { icon: MessageSquare, active: false },
            ].map((tab, i) => (
              <tab.icon
                key={i}
                style={{ width: 10, height: 10, color: tab.active ? accent : portalTextTer }}
              />
            ))}
          </div>
        </div>
        <p className="font-kosugi text-[11px] text-text-mute mt-1.5">
          Live preview of your client portal. Changes update instantly.
        </p>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex gap-3 items-start">
      {/* ── Left column — settings form ─────────────────────────────────── */}
      <div className="space-y-3 flex-1 min-w-0">
      {/* ── Portal Logo ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("portalBranding.logoTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-2 rounded border border-border bg-surface-input flex items-center gap-2 min-h-[56px]">
            {company?.logoURL ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={company.logoURL}
                  alt="Company logo"
                  className="max-h-[40px] max-w-[120px] object-contain"
                />
                <span className="font-kosugi text-[11px] text-text-mute">
                  Using your company logo
                </span>
              </>
            ) : (
              <div className="flex items-center gap-1.5">
                <Building2 className="w-[20px] h-[20px] text-text-mute" />
                <span className="font-kosugi text-[11px] text-text-mute">
                  No company logo set — upload one in Company Details
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Accent Color ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("portalBranding.accentTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Suggested colors from logo */}
          {suggestedColors.length > 0 && (
            <div className="space-y-1">
              <p className="font-kosugi text-micro text-text-mute uppercase tracking-wider">
                Suggested from your logo
              </p>
              <div className="flex gap-1.5">
                {suggestedColors.map((hex) => (
                  <button
                    key={hex}
                    disabled={!canManage}
                    onClick={() => {
                      if (!canManage) return;
                      setAccentColor(hex);
                      markDirty();
                    }}
                    className={cn(
                      "relative w-[36px] h-[36px] rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed",
                      accentColor === hex
                        ? "border-[rgba(255,255,255,0.4)] ring-1 ring-[rgba(255,255,255,0.2)]"
                        : "border-[rgba(255,255,255,0.15)] hover:border-[rgba(255,255,255,0.3)]"
                    )}
                    style={{ backgroundColor: hex }}
                    title={hex}
                  >
                    {accentColor === hex && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Check className="w-[14px] h-[14px] text-white drop-shadow-sm" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Preset swatches — grid of larger color chips */}
          <div className="grid grid-cols-4 gap-1.5">
            {ACCENT_COLORS.map((color) => (
              <button
                key={color.hex}
                disabled={!canManage}
                onClick={() => {
                  if (!canManage) return;
                  setAccentColor(color.hex);
                  markDirty();
                }}
                className={cn(
                  "relative flex flex-col items-center gap-1 py-1.5 rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed",
                  accentColor === color.hex
                    ? "border-[rgba(255,255,255,0.4)] bg-[rgba(255,255,255,0.06)]"
                    : "border-border hover:border-border-medium"
                )}
              >
                <span
                  className="w-[32px] h-[32px] rounded-lg border border-[rgba(255,255,255,0.15)]"
                  style={{ backgroundColor: color.hex }}
                />
                <span className="font-kosugi text-micro text-text-3 leading-tight">
                  {color.name}
                </span>
                {accentColor === color.hex && (
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
                if (!canManage) return;
                setAccentColor(e.target.value);
                markDirty();
              }}
              placeholder={t("portalBranding.colorPlaceholder")}
              disabled={!canManage}
              className="w-[140px] font-mono"
              error={!isValidHex && accentColor.length > 0 ? t("portalBranding.invalidColor") : undefined}
            />
            <span className="font-kosugi text-micro text-text-mute">
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
                disabled={!canManage}
                onClick={() => {
                  if (!canManage) return;
                  setTemplate(tmpl.id);
                  markDirty();
                }}
                className={cn(
                  "w-full flex items-center justify-between px-1.5 py-1 rounded border transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed",
                  template === tmpl.id
                    ? "bg-ops-accent-muted border-ops-accent"
                    : "bg-surface-input border-border hover:border-border-medium"
                )}
              >
                <div>
                  <p className="font-mohave text-body text-text">{t(tmpl.labelKey)}</p>
                  <p className="font-kosugi text-[11px] text-text-3">{t(tmpl.descKey)}</p>
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
                disabled={!canManage}
                onClick={() => {
                  if (!canManage) return;
                  setThemeMode(mode.id);
                  markDirty();
                }}
                className={cn(
                  "flex flex-col items-center gap-[6px] py-1.5 rounded border transition-all disabled:opacity-40 disabled:cursor-not-allowed",
                  themeMode === mode.id
                    ? "bg-ops-accent-muted border-ops-accent"
                    : "bg-surface-input border-border hover:border-border-medium"
                )}
              >
                <mode.icon
                  className={cn(
                    "w-[20px] h-[20px]",
                    themeMode === mode.id ? "text-ops-accent" : "text-text-3"
                  )}
                />
                <span
                  className={cn(
                    "font-mohave text-body-sm",
                    themeMode === mode.id ? "text-ops-accent" : "text-text-2"
                  )}
                >
                  {mode.label}
                </span>
              </button>
            ))}
          </div>
          <p className="font-kosugi text-[11px] text-text-mute mt-1">
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
              if (!canManage) return;
              setWelcomeMessage(e.target.value);
              markDirty();
            }}
            placeholder={t("portalBranding.welcomePlaceholder")}
            helperText={t("portalBranding.welcomeHelper")}
            disabled={!canManage}
            className="min-h-[100px]"
          />
        </CardContent>
      </Card>

      {/* ── Document Display — Visibility Overrides ──────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("portalBranding.visibilityTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="font-kosugi text-[11px] text-text-mute mb-2">
            {t("portalBranding.visibilityDesc")}
          </p>

          {([
            { key: "showQuantities" as const, labelKey: "portalBranding.quantities", state: showQuantities, setter: setShowQuantities },
            { key: "showUnitPrices" as const, labelKey: "portalBranding.unitPrices", state: showUnitPrices, setter: setShowUnitPrices },
            { key: "showLineTotals" as const, labelKey: "portalBranding.lineTotals", state: showLineTotals, setter: setShowLineTotals },
            { key: "showDescriptions" as const, labelKey: "portalBranding.descriptions", state: showDescriptions, setter: setShowDescriptions },
            { key: "showTax" as const, labelKey: "portalBranding.tax", state: showTax, setter: setShowTax },
            { key: "showDiscount" as const, labelKey: "portalBranding.discount", state: showDiscount, setter: setShowDiscount },
          ]).map(({ key, labelKey, state, setter }) => (
            <div key={key} className="flex items-center justify-between py-1.5">
              <span className="font-mohave text-body-sm text-text-2">
                {t(labelKey)}
              </span>
              <div className="flex rounded border border-border overflow-hidden">
                {([
                  { value: null, label: t("portalBranding.useTemplate") },
                  { value: true, label: t("portalBranding.alwaysShow") },
                  { value: false, label: t("portalBranding.alwaysHide") },
                ] as { value: boolean | null; label: string }[]).map((opt) => (
                  <button
                    key={String(opt.value)}
                    disabled={!canManage}
                    onClick={() => {
                      if (!canManage) return;
                      setter(opt.value);
                      markDirty();
                    }}
                    className={cn(
                      "px-2 py-1 text-[11px] font-kosugi transition-all border-r last:border-r-0 border-border disabled:opacity-40 disabled:cursor-not-allowed",
                      state === opt.value
                        ? "bg-ops-accent-muted text-ops-accent"
                        : "bg-surface-input text-text-3 hover:text-text-2"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Inline Preview (visible below xl) ───────────────────────────── */}
      <div className="xl:hidden">
        {previewBlock}
      </div>

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-1">
        <p className="font-kosugi text-[11px] text-text-mute">
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
          {isDirty && (
            <Button
              variant="ghost"
              onClick={handleDiscard}
            >
              <RotateCcw className="w-[16px] h-[16px]" />
              Discard
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => { if (!can("portal.manage_branding")) return; saveMutation.mutate(); }}
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
