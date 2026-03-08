"use client";

import { useState, useEffect } from "react";
import {
  Check,
  Loader2,
  Save,
  Plus,
  Trash2,
  Moon,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/store/auth-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { documentTemplateKeys } from "@/lib/api/services/document-template-service";
import type {
  DocumentTemplate,
  DocumentType,
  CreateDocumentTemplate,
} from "@/lib/types/document-template";
import { DEFAULT_FIELD_VISIBILITY } from "@/lib/types/document-template";
import type { PortalTemplate, PortalThemeMode } from "@/lib/types/portal";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

// ─── Constants ───────────────────────────────────────────────────────────────

const DOC_TYPE_OPTIONS: { id: DocumentType; labelKey: string }[] = [
  { id: "invoice", labelKey: "templates.invoice" },
  { id: "estimate", labelKey: "templates.estimate" },
  { id: "both", labelKey: "templates.both" },
];

const FIELD_LABELS: { key: keyof typeof DEFAULT_FIELD_VISIBILITY; labelKey: string }[] = [
  { key: "showQuantities", labelKey: "templates.quantities" },
  { key: "showUnitPrices", labelKey: "templates.unitPrices" },
  { key: "showLineTotals", labelKey: "templates.lineTotals" },
  { key: "showDescriptions", labelKey: "templates.descriptions" },
  { key: "showTax", labelKey: "templates.tax" },
  { key: "showDiscount", labelKey: "templates.discount" },
  { key: "showTerms", labelKey: "templates.termsConditions" },
  { key: "showFooter", labelKey: "templates.footer" },
  { key: "showPaymentInfo", labelKey: "templates.paymentInfo" },
  { key: "showFromSection", labelKey: "templates.fromCompany" },
  { key: "showToSection", labelKey: "templates.toClient" },
];

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

const TEMPLATES: { id: PortalTemplate; labelKey: string }[] = [
  { id: "modern", labelKey: "portalBranding.modern" },
  { id: "classic", labelKey: "portalBranding.classic" },
  { id: "bold", labelKey: "portalBranding.bold" },
];

// ─── API Helpers ──────────────────────────────────────────────────────────────

function mapFromApi(row: Record<string, unknown>): DocumentTemplate {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    documentType: row.document_type as DocumentType,
    isDefault: (row.is_default as boolean) ?? false,
    showQuantities: (row.show_quantities as boolean) ?? true,
    showUnitPrices: (row.show_unit_prices as boolean) ?? true,
    showLineTotals: (row.show_line_totals as boolean) ?? true,
    showDescriptions: (row.show_descriptions as boolean) ?? true,
    showTax: (row.show_tax as boolean) ?? true,
    showDiscount: (row.show_discount as boolean) ?? true,
    showTerms: (row.show_terms as boolean) ?? true,
    showFooter: (row.show_footer as boolean) ?? true,
    showPaymentInfo: (row.show_payment_info as boolean) ?? true,
    showFromSection: (row.show_from_section as boolean) ?? true,
    showToSection: (row.show_to_section as boolean) ?? true,
    overrideLogoUrl: (row.override_logo_url as string) ?? null,
    overrideAccentColor: (row.override_accent_color as string) ?? null,
    overrideTemplate: (row.override_template as "modern" | "classic" | "bold") ?? null,
    overrideThemeMode: (row.override_theme_mode as "light" | "dark") ?? null,
    overrideFontCombo: (row.override_font_combo as "modern" | "classic" | "bold") ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapToApi(data: Partial<CreateDocumentTemplate>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (data.companyId !== undefined) row.company_id = data.companyId;
  if (data.name !== undefined) row.name = data.name;
  if (data.documentType !== undefined) row.document_type = data.documentType;
  if (data.isDefault !== undefined) row.is_default = data.isDefault;
  if (data.showQuantities !== undefined) row.show_quantities = data.showQuantities;
  if (data.showUnitPrices !== undefined) row.show_unit_prices = data.showUnitPrices;
  if (data.showLineTotals !== undefined) row.show_line_totals = data.showLineTotals;
  if (data.showDescriptions !== undefined) row.show_descriptions = data.showDescriptions;
  if (data.showTax !== undefined) row.show_tax = data.showTax;
  if (data.showDiscount !== undefined) row.show_discount = data.showDiscount;
  if (data.showTerms !== undefined) row.show_terms = data.showTerms;
  if (data.showFooter !== undefined) row.show_footer = data.showFooter;
  if (data.showPaymentInfo !== undefined) row.show_payment_info = data.showPaymentInfo;
  if (data.showFromSection !== undefined) row.show_from_section = data.showFromSection;
  if (data.showToSection !== undefined) row.show_to_section = data.showToSection;
  if (data.overrideLogoUrl !== undefined) row.override_logo_url = data.overrideLogoUrl;
  if (data.overrideAccentColor !== undefined) row.override_accent_color = data.overrideAccentColor;
  if (data.overrideTemplate !== undefined) row.override_template = data.overrideTemplate;
  if (data.overrideThemeMode !== undefined) row.override_theme_mode = data.overrideThemeMode;
  if (data.overrideFontCombo !== undefined) row.override_font_combo = data.overrideFontCombo;
  return row;
}

async function apiFetchTemplates(): Promise<DocumentTemplate[]> {
  const res = await fetch("/api/documents/templates");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to fetch templates");
  }
  const rows = await res.json();
  return (rows as Record<string, unknown>[]).map(mapFromApi);
}

async function apiCreateTemplate(data: CreateDocumentTemplate): Promise<DocumentTemplate> {
  const res = await fetch("/api/documents/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mapToApi(data)),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to create template");
  }
  return mapFromApi(await res.json());
}

async function apiUpdateTemplate(
  id: string,
  data: Partial<CreateDocumentTemplate>
): Promise<DocumentTemplate> {
  const res = await fetch(`/api/documents/templates/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mapToApi(data)),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to update template");
  }
  return mapFromApi(await res.json());
}

async function apiDeleteTemplate(id: string): Promise<void> {
  const res = await fetch(`/api/documents/templates/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to delete template");
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DocumentTemplatesTab() {
  const { t } = useDictionary("settings");
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";
  const queryClient = useQueryClient();

  // ── List + selection state ───────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Editor form state ────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("both");
  const [isDefault, setIsDefault] = useState(false);
  const [fields, setFields] = useState({ ...DEFAULT_FIELD_VISIBILITY });
  const [overrideAccent, setOverrideAccent] = useState(false);
  const [accentColor, setAccentColor] = useState("#417394");
  const [overrideLogoToggle, setOverrideLogoToggle] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  const [overrideTemplateToggle, setOverrideTemplateToggle] = useState(false);
  const [templateChoice, setTemplateChoice] = useState<PortalTemplate>("modern");
  const [overrideThemeToggle, setOverrideThemeToggle] = useState(false);
  const [themeMode, setThemeMode] = useState<PortalThemeMode>("dark");
  const [isDirty, setIsDirty] = useState(false);

  // ── Fetch templates ──────────────────────────────────────────────────────
  const {
    data: templates = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: documentTemplateKeys.list(companyId),
    queryFn: () => apiFetchTemplates(),
    enabled: !!companyId,
    staleTime: 10 * 60 * 1000,
  });

  // ── Seed form when selection changes ─────────────────────────────────────
  const selectedTemplate = templates.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedTemplate) {
      setName(selectedTemplate.name);
      setDocumentType(selectedTemplate.documentType);
      setIsDefault(selectedTemplate.isDefault);
      setFields({
        showQuantities: selectedTemplate.showQuantities,
        showUnitPrices: selectedTemplate.showUnitPrices,
        showLineTotals: selectedTemplate.showLineTotals,
        showDescriptions: selectedTemplate.showDescriptions,
        showTax: selectedTemplate.showTax,
        showDiscount: selectedTemplate.showDiscount,
        showTerms: selectedTemplate.showTerms,
        showFooter: selectedTemplate.showFooter,
        showPaymentInfo: selectedTemplate.showPaymentInfo,
        showFromSection: selectedTemplate.showFromSection,
        showToSection: selectedTemplate.showToSection,
      });
      setOverrideAccent(!!selectedTemplate.overrideAccentColor);
      setAccentColor(selectedTemplate.overrideAccentColor ?? "#417394");
      setOverrideLogoToggle(!!selectedTemplate.overrideLogoUrl);
      setLogoUrl(selectedTemplate.overrideLogoUrl ?? "");
      setOverrideTemplateToggle(!!selectedTemplate.overrideTemplate);
      setTemplateChoice(selectedTemplate.overrideTemplate ?? "modern");
      setOverrideThemeToggle(!!selectedTemplate.overrideThemeMode);
      setThemeMode(selectedTemplate.overrideThemeMode ?? "dark");
      setIsDirty(false);
    }
  }, [selectedTemplate]);

  // ── Create mutation ──────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: CreateDocumentTemplate) =>
      apiCreateTemplate(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: documentTemplateKeys.list(companyId) });
      setSelectedId(created.id);
      toast.success(t("templates.toast.created"));
    },
    onError: (err) => {
      toast.error(t("templates.toast.createFailed"), {
        description: err instanceof Error ? err.message : t("templates.toast.tryAgain"),
      });
    },
  });

  // ── Update mutation ──────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateDocumentTemplate>;
    }) => apiUpdateTemplate(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentTemplateKeys.list(companyId) });
      setIsDirty(false);
      toast.success(t("templates.toast.saved"));
    },
    onError: (err) => {
      toast.error(t("templates.toast.saveFailed"), {
        description: err instanceof Error ? err.message : t("templates.toast.tryAgain"),
      });
    },
  });

  // ── Delete mutation ──────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDeleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentTemplateKeys.list(companyId) });
      setSelectedId(null);
      toast.success(t("templates.toast.deleted"));
    },
    onError: (err) => {
      toast.error(t("templates.toast.deleteFailed"), {
        description: err instanceof Error ? err.message : t("templates.toast.tryAgain"),
      });
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────
  function markDirty() {
    if (!isDirty) setIsDirty(true);
  }

  function handleCreate() {
    createMutation.mutate({
      companyId,
      name: t("templates.newTemplateName"),
      documentType: "both",
      isDefault: false,
      ...DEFAULT_FIELD_VISIBILITY,
      overrideLogoUrl: null,
      overrideAccentColor: null,
      overrideTemplate: null,
      overrideThemeMode: null,
      overrideFontCombo: null,
    });
  }

  function handleSave() {
    if (!selectedId) return;
    updateMutation.mutate({
      id: selectedId,
      data: {
        name,
        documentType,
        isDefault,
        ...fields,
        overrideLogoUrl: overrideLogoToggle ? (logoUrl.trim() || null) : null,
        overrideAccentColor: overrideAccent ? accentColor : null,
        overrideTemplate: overrideTemplateToggle ? templateChoice : null,
        overrideThemeMode: overrideThemeToggle ? themeMode : null,
        overrideFontCombo: overrideTemplateToggle ? templateChoice : null,
      },
    });
  }

  function handleDelete() {
    if (!selectedId) return;
    deleteMutation.mutate(selectedId);
  }

  // ── Loading/error states ─────────────────────────────────────────────────
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
            {t("templates.loadFailed")}
            {error instanceof Error ? `: ${error.message}` : ""}
          </p>
        </CardContent>
      </Card>
    );
  }

  const isValidHex = /^#[0-9A-Fa-f]{6}$/.test(accentColor);

  return (
    <div className="space-y-3">
      {/* ── Template List ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("templates.title")}</CardTitle>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCreate}
            disabled={createMutation.isPending}
            loading={createMutation.isPending}
          >
            <Plus className="w-[14px] h-[14px]" />
            {t("templates.createTemplate")}
          </Button>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="font-kosugi text-[11px] text-text-disabled text-center py-2">
              {t("templates.emptyState")}
            </p>
          ) : (
            <div className="space-y-1">
              {templates.map((tmpl) => (
                <button
                  key={tmpl.id}
                  onClick={() => setSelectedId(tmpl.id)}
                  className={cn(
                    "w-full flex items-center justify-between px-1.5 py-1 rounded border transition-all text-left",
                    selectedId === tmpl.id
                      ? "bg-ops-accent-muted border-ops-accent"
                      : "bg-background-input border-border hover:border-border-medium"
                  )}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="font-mohave text-body text-text-primary truncate">
                      {tmpl.name}
                    </p>
                    <span className="font-kosugi text-[10px] text-text-tertiary px-1 py-0.5 rounded bg-background-elevated shrink-0 uppercase">
                      {tmpl.documentType}
                    </span>
                    {tmpl.isDefault && (
                      <span className="font-kosugi text-[10px] text-ops-accent px-1 py-0.5 rounded bg-ops-accent-muted shrink-0">
                        {t("templates.default")}
                      </span>
                    )}
                  </div>
                  {selectedId === tmpl.id && (
                    <Check className="w-[14px] h-[14px] text-ops-accent shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Editor (visible when a template is selected) ──────────────────── */}
      {selectedTemplate && (
        <>
          {/* Name & Type */}
          <Card>
            <CardHeader>
              <CardTitle>{t("templates.nameType")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Input
                label={t("templates.templateName")}
                value={name}
                onChange={(e) => { setName(e.target.value); markDirty(); }}
                placeholder={t("templates.namePlaceholder")}
              />

              <div>
                <p className="font-mohave text-body-sm text-text-secondary mb-0.5">
                  Document Type
                </p>
                <div className="flex gap-1">
                  {DOC_TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => { setDocumentType(opt.id); markDirty(); }}
                      className={cn(
                        "flex-1 py-[8px] rounded border transition-all font-mohave text-body-sm text-center",
                        documentType === opt.id
                          ? "bg-ops-accent-muted border-ops-accent text-ops-accent"
                          : "bg-background-input border-border text-text-secondary hover:border-border-medium"
                      )}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-0.5">
                <div>
                  <p className="font-mohave text-body-sm text-text-primary">
                    {t("templates.setAsDefault")}
                  </p>
                  <p className="font-kosugi text-[11px] text-text-disabled">
                    {t("templates.autoApply")} {documentType === "both" ? "invoices & estimates" : `${documentType}s`}
                  </p>
                </div>
                <Switch
                  checked={isDefault}
                  onCheckedChange={(v) => { setIsDefault(v); markDirty(); }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Field Visibility */}
          <Card>
            <CardHeader>
              <CardTitle>{t("templates.fieldVisibility")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {FIELD_LABELS.map(({ key, labelKey }) => (
                  <div key={key} className="flex items-center justify-between py-0.5">
                    <span className="font-mohave text-body-sm text-text-secondary">
                      {t(labelKey)}
                    </span>
                    <Switch
                      checked={fields[key]}
                      onCheckedChange={(v) => {
                        setFields((prev) => ({ ...prev, [key]: v }));
                        markDirty();
                      }}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Branding Overrides */}
          <Card>
            <CardHeader>
              <CardTitle>{t("templates.brandingOverrides")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="font-kosugi text-[11px] text-text-disabled">
                {t("templates.brandingHelper")}
              </p>

              {/* Accent Color Override */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mohave text-body-sm text-text-secondary">
                    {t("templates.accentColor")}
                  </span>
                  <Switch
                    checked={overrideAccent}
                    onCheckedChange={(v) => { setOverrideAccent(v); markDirty(); }}
                  />
                </div>
                {overrideAccent && (
                  <div className="pl-1 space-y-1">
                    <div className="flex flex-wrap gap-1">
                      {ACCENT_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          onClick={() => { setAccentColor(preset.value); markDirty(); }}
                          className={cn(
                            "flex items-center gap-[4px] px-1 py-[6px] rounded border transition-all",
                            accentColor === preset.value
                              ? "border-[rgba(255,255,255,0.4)] bg-[rgba(255,255,255,0.06)]"
                              : "border-border hover:border-border-medium"
                          )}
                        >
                          <span
                            className="w-[14px] h-[14px] rounded-full border border-[rgba(255,255,255,0.2)]"
                            style={{ backgroundColor: preset.value }}
                          />
                          <span className="font-mohave text-[11px] text-text-secondary">
                            {t(preset.labelKey)}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <Input
                        value={accentColor}
                        onChange={(e) => { setAccentColor(e.target.value); markDirty(); }}
                        placeholder="#417394"
                        className="w-[140px] font-mono"
                        error={!isValidHex && accentColor.length > 0 ? t("templates.invalidColor") : undefined}
                      />
                      {isValidHex && (
                        <div
                          className="w-7 h-7 rounded border border-[rgba(255,255,255,0.2)] shrink-0"
                          style={{ backgroundColor: accentColor }}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Logo Override */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mohave text-body-sm text-text-secondary">
                    {t("templates.logo")}
                  </span>
                  <Switch
                    checked={overrideLogoToggle}
                    onCheckedChange={(v) => { setOverrideLogoToggle(v); markDirty(); }}
                  />
                </div>
                {overrideLogoToggle && (
                  <div className="pl-1">
                    <Input
                      value={logoUrl}
                      onChange={(e) => { setLogoUrl(e.target.value); markDirty(); }}
                      placeholder={t("portalBranding.logoPlaceholder")}
                    />
                  </div>
                )}
              </div>

              {/* Template Override */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mohave text-body-sm text-text-secondary">
                    {t("templates.templateStyle")}
                  </span>
                  <Switch
                    checked={overrideTemplateToggle}
                    onCheckedChange={(v) => { setOverrideTemplateToggle(v); markDirty(); }}
                  />
                </div>
                {overrideTemplateToggle && (
                  <div className="pl-1 flex gap-1">
                    {TEMPLATES.map((tmpl) => (
                      <button
                        key={tmpl.id}
                        onClick={() => { setTemplateChoice(tmpl.id); markDirty(); }}
                        className={cn(
                          "flex-1 py-[8px] rounded border transition-all font-mohave text-body-sm text-center",
                          templateChoice === tmpl.id
                            ? "bg-ops-accent-muted border-ops-accent text-ops-accent"
                            : "bg-background-input border-border text-text-secondary hover:border-border-medium"
                        )}
                      >
                        {t(tmpl.labelKey)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Theme Mode Override */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mohave text-body-sm text-text-secondary">
                    {t("templates.themeMode")}
                  </span>
                  <Switch
                    checked={overrideThemeToggle}
                    onCheckedChange={(v) => { setOverrideThemeToggle(v); markDirty(); }}
                  />
                </div>
                {overrideThemeToggle && (
                  <div className="pl-1 grid grid-cols-2 gap-1">
                    {([
                      { id: "light" as PortalThemeMode, label: t("portalBranding.themeLight"), icon: Sun },
                      { id: "dark" as PortalThemeMode, label: t("portalBranding.themeDark"), icon: Moon },
                    ]).map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => { setThemeMode(mode.id); markDirty(); }}
                        className={cn(
                          "flex items-center justify-center gap-[6px] py-[8px] rounded border transition-all",
                          themeMode === mode.id
                            ? "bg-ops-accent-muted border-ops-accent"
                            : "bg-background-input border-border hover:border-border-medium"
                        )}
                      >
                        <mode.icon
                          className={cn(
                            "w-[16px] h-[16px]",
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
                )}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              loading={deleteMutation.isPending}
              className="text-ops-error hover:bg-ops-error/10"
            >
              <Trash2 className="w-[14px] h-[14px]" />
              {t("templates.deleteTemplate")}
            </Button>
            <div className="flex items-center gap-1.5">
              <p className="font-kosugi text-[11px] text-text-disabled">
                {isDirty ? t("templates.unsavedChanges") : t("templates.saved")}
              </p>
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={!isDirty || updateMutation.isPending || !name.trim() || (overrideAccent && !isValidHex)}
                loading={updateMutation.isPending}
              >
                <Save className="w-[16px] h-[16px]" />
                {t("templates.saveTemplate")}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
