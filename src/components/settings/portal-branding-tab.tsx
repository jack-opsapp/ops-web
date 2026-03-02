"use client";

import { useState, useEffect } from "react";
import {
  Check,
  Loader2,
  Save,
  Moon,
  Sun,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/store/auth-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { requireSupabase, parseDateRequired } from "@/lib/supabase/helpers";
import type {
  PortalBranding,
  PortalTemplate,
  PortalThemeMode,
} from "@/lib/types/portal";
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

// ─── Preset accent colors ────────────────────────────────────────────────────

const ACCENT_PRESETS = [
  { labelKey: "portalBranding.steelBlue", value: "#417394" },
  { labelKey: "portalBranding.amberGold", value: "#C4A868" },
  { labelKey: "portalBranding.sage", value: "#7D9B76" },
  { labelKey: "portalBranding.terracotta", value: "#C07A56" },
  { labelKey: "portalBranding.dustyRose", value: "#C2858A" },
  { labelKey: "portalBranding.slate", value: "#7A8B99" },
  { labelKey: "portalBranding.sandstone", value: "#B8A68E" },
  { labelKey: "portalBranding.forest", value: "#5B7B5E" },
];

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
  const [accentColor, setAccentColor] = useState("#417394");
  const [template, setTemplate] = useState<PortalTemplate>("modern");
  const [themeMode, setThemeMode] = useState<PortalThemeMode>("dark");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

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
      // Default portal logo to company logo if not explicitly set
      setLogoUrl(branding.logoUrl ?? company?.logoURL ?? "");
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
        logoUrl: logoUrl.trim() || null,
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

  return (
    <div className="space-y-3 max-w-[600px]">
      {/* ── Logo URL ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("portalBranding.logoTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Input
            label={t("portalBranding.logoUrl")}
            value={logoUrl}
            onChange={(e) => {
              setLogoUrl(e.target.value);
              markDirty();
            }}
            placeholder={t("portalBranding.logoPlaceholder")}
            helperText={t("portalBranding.logoHelper")}
          />
          {logoUrl.trim() && (
            <div className="mt-1 p-1.5 rounded border border-border bg-background-input flex items-center justify-center min-h-[60px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl.trim()}
                alt="Logo preview"
                className="max-h-[48px] max-w-full object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
                onLoad={(e) => {
                  (e.target as HTMLImageElement).style.display = "block";
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Accent Color ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("portalBranding.accentTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {/* Preset swatches */}
          <div className="flex flex-wrap gap-1.5">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => {
                  setAccentColor(preset.value);
                  markDirty();
                }}
                className={cn(
                  "flex items-center gap-[6px] px-1.5 py-[8px] rounded border transition-all",
                  accentColor === preset.value
                    ? "border-[rgba(255,255,255,0.4)] bg-[rgba(255,255,255,0.06)]"
                    : "border-border hover:border-border-medium"
                )}
              >
                <span
                  className="w-[16px] h-[16px] rounded-full border border-[rgba(255,255,255,0.2)]"
                  style={{ backgroundColor: preset.value }}
                />
                <span className="font-mohave text-body-sm text-text-secondary">
                  {t(preset.labelKey)}
                </span>
                {accentColor === preset.value && (
                  <Check className="w-[12px] h-[12px] text-ops-accent" />
                )}
              </button>
            ))}
          </div>

          {/* Custom hex input */}
          <div className="flex items-center gap-1.5 mt-1">
            <div className="relative">
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
            </div>
            {isValidHex && (
              <div
                className="w-7 h-7 rounded border border-[rgba(255,255,255,0.2)] shrink-0"
                style={{ backgroundColor: accentColor }}
              />
            )}
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
  );
}
