"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Save, Upload, Loader2, Copy, Check, Crosshair, Search, X } from "lucide-react";
import { INDUSTRIES } from "@/lib/data/industries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { SegmentControl, type SegmentControlOption } from "@/components/ui/segment-control";
import { useCompany, useUpdateCompany, useImageUpload } from "@/lib/hooks";
import { useGeolocationAddress } from "@/lib/hooks/use-geolocation-address";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { cn } from "@/lib/utils/cn";

// ---------------------------------------------------------------------------
// Industry Picker — searchable, scrollable, with selected tags
// ---------------------------------------------------------------------------
function IndustryPicker({
  industries,
  setIndustries,
  search,
  setSearch,
  disabled,
}: {
  industries: string[];
  setIndustries: React.Dispatch<React.SetStateAction<string[]>>;
  search: string;
  setSearch: (s: string) => void;
  disabled: boolean;
}) {
  const { t } = useDictionary("settings");
  const filtered = useMemo(() => {
    if (!search.trim()) return INDUSTRIES;
    const q = search.trim().toLowerCase();
    return INDUSTRIES.filter((i) => i.toLowerCase().includes(q));
  }, [search]);

  function toggle(industry: string) {
    setIndustries((prev) =>
      prev.includes(industry) ? prev.filter((i) => i !== industry) : [...prev, industry]
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
        <span className="text-text-mute">{"// "}</span>
        {t("company.industries")}
      </span>

      {/* Selected tags */}
      {industries.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {industries.map((ind) => (
            <button
              key={ind}
              type="button"
              disabled={disabled}
              onClick={() => toggle(ind)}
              className="rounded-[4px] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
            >
              <Tag className="gap-[4px]">
                {ind}
                <X className="w-[10px] h-[10px]" />
              </Tag>
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-[6px] px-1.5 py-[6px] rounded-[5px] border border-border bg-surface-input">
        <Search className="w-[14px] h-[14px] text-text-mute shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("company.industrySearchPlaceholder")}
          className="flex-1 bg-transparent text-text font-mohave text-body-sm placeholder:text-text-mute outline-none"
        />
        {search && (
          <button type="button" onClick={() => setSearch("")} className="text-text-mute hover:text-text-3">
            <X className="w-[12px] h-[12px]" />
          </button>
        )}
      </div>

      {/* Scrollable options grid */}
      <div className="max-h-[180px] overflow-y-auto scrollbar-hide rounded-[5px] border border-border bg-surface-input/50 p-1">
        <div className="flex flex-wrap gap-[4px]">
          {filtered.map((ind) => {
            const isSelected = industries.includes(ind);
            return (
              <button
                key={ind}
                type="button"
                disabled={disabled}
                onClick={() => toggle(ind)}
                className={cn(
                  "px-[8px] py-[3px] rounded-[4px] font-mohave text-caption transition-colors border disabled:opacity-40 disabled:cursor-not-allowed",
                  isSelected
                    ? "bg-surface-active border-[rgba(255,255,255,0.18)] text-text"
                    : "bg-transparent border-border text-text-3 hover:text-text-2 hover:border-[rgba(255,255,255,0.18)]"
                )}
              >
                {ind}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <span className="font-mono text-[11px] text-text-mute px-1 py-2">
              {t("company.noTradesFound")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function CompanyTab() {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const { data: company, isLoading: isCompanyLoading } = useCompany();
  const updateCompany = useUpdateCompany();

  const logoUpload = useImageUpload({
    onSuccess: (url) => {
      if (company) {
        updateCompany.mutate(
          { id: company.id, data: { logoURL: url } },
          { onSuccess: () => toast.success(t("company.toast.logoUpdated")) }
        );
      }
    },
    onError: () => toast.error(t("company.toast.logoFailed")),
  });
  const logoInputRef = useRef<HTMLInputElement>(null);

  const { getAddress, loading: locating } = useGeolocationAddress();
  const [codeCopied, setCodeCopied] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [openHour, setOpenHour] = useState("");
  const [closeHour, setCloseHour] = useState("");
  const [industries, setIndustries] = useState<string[]>([]);
  const [companySize, setCompanySize] = useState("");
  const [companyAge, setCompanyAge] = useState("");
  const [industrySearch, setIndustrySearch] = useState("");

  useEffect(() => {
    if (company) {
      setCompanyName(company.name ?? "");
      setCompanyAddress(company.address ?? "");
      setCompanyPhone(company.phone ?? "");
      setCompanyEmail(company.email ?? "");
      setCompanyWebsite(company.website ?? "");
      setCompanyDescription(company.companyDescription ?? "");
      setOpenHour(company.openHour ?? "");
      setCloseHour(company.closeHour ?? "");
      setIndustries(company.industries ?? []);
      setCompanySize(company.companySize ?? "");
      setCompanyAge(company.companyAge ?? "");
    }
  }, [company]);

  async function handleSave() {
    if (!can("settings.company")) return;
    if (!company) return;

    updateCompany.mutate(
      {
        id: company.id,
        data: {
          name: companyName.trim(),
          address: companyAddress.trim() || null,
          phone: companyPhone.trim() || null,
          email: companyEmail.trim() || null,
          website: companyWebsite.trim() || null,
          companyDescription: companyDescription.trim() || null,
          openHour: openHour.trim() || null,
          closeHour: closeHour.trim() || null,
          industries,
          companySize: companySize.trim() || null,
          companyAge: companyAge.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success(t("company.toast.updated"));
        },
        onError: (error) => {
          toast.error(t("company.toast.updateFailed"), {
            description: error instanceof Error ? error.message : t("company.toast.tryAgain"),
          });
        },
      }
    );
  }

  // Team size codes double as label + stored value (stable, never translated).
  const teamSizeOptions: SegmentControlOption<string>[] = [
    { value: "1-5", label: "1-5" },
    { value: "6-15", label: "6-15" },
    { value: "16-50", label: "16-50" },
    { value: "51-200", label: "51-200" },
    { value: "200+", label: "200+" },
  ];
  // Years-in-business: label is translated, value is the persisted string — the
  // stored value must stay byte-stable, only the display label is localized.
  const companyAgeOptions: SegmentControlOption<string>[] = [
    { value: "Less than 1 year", label: t("company.age.lt1") },
    { value: "1-3 years", label: t("company.age.1to3") },
    { value: "3-5 years", label: t("company.age.3to5") },
    { value: "5-10 years", label: t("company.age.5to10") },
    { value: "10+", label: t("company.age.10plus") },
  ];

  if (isCompanyLoading && !company) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-[24px] h-[24px] text-text-2 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-3xl">
      <Card>
        <CardContent className="space-y-2">
          <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
            <span className="text-text-mute">{"// "}</span>
            {t("company.title")}
          </span>
          <div className="flex flex-col gap-0.5">
            <label className="font-mono text-micro text-text-3 uppercase tracking-[0.16em]">
              {t("company.logo")}
            </label>
            <div className="flex items-center gap-1.5">
              <div className="relative w-[56px] h-[56px] rounded-panel bg-fill-neutral-dim border border-border flex items-center justify-center overflow-hidden">
                {logoUpload.isUploading ? (
                  <>
                    {/* Show preview as background while uploading */}
                    {logoUpload.preview ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={logoUpload.preview}
                        alt=""
                        className="w-full h-full object-cover opacity-30"
                      />
                    ) : company?.logoURL ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={company.logoURL}
                        alt=""
                        className="w-full h-full object-cover opacity-30"
                      />
                    ) : null}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="w-[20px] h-[20px] text-text-2 animate-spin" />
                    </div>
                  </>
                ) : company?.logoURL ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={company.logoURL}
                    alt="Company logo"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  // Bug d0be7f4a — company-logo placeholder mirrors the
                  // user/client avatar treatment: monochrome glass + JetBrains
                  // Mono uppercase initials, never the generic Building2 icon.
                  <span
                    className="font-mono text-[15px] uppercase tracking-wider"
                    style={{ color: "var(--text-2)" }}
                  >
                    {(companyName || company?.name || "?")
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((w) => w.charAt(0).toUpperCase())
                      .join("") || "?"}
                  </span>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="gap-[6px]"
                disabled={!can("settings.company") || logoUpload.isUploading}
                onClick={() => logoInputRef.current?.click()}
              >
                {logoUpload.isUploading ? (
                  <>
                    <Loader2 className="w-[14px] h-[14px] animate-spin" />
                    {t("company.uploading")}
                  </>
                ) : (
                  <>
                    <Upload className="w-[14px] h-[14px]" />
                    {t("company.upload")}
                  </>
                )}
              </Button>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  if (!can("settings.company")) return;
                  const file = e.target.files?.[0];
                  if (file) logoUpload.selectFile(file);
                }}
              />
            </div>
          </div>

          <Input label={t("company.name")} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />

          {/* Company Code (read-only) */}
          {company?.companyCode && (
            <div className="flex flex-col gap-0.5">
              <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
                {t("company.companyCode")}
              </label>
              <div className="flex items-center gap-1">
                <div className="flex-1 flex items-center px-1.5 py-[10px] rounded-[5px] border border-border bg-fill-neutral-dim">
                  <span className="font-mono text-body-sm text-text tracking-wider tabular-nums">
                    {company.companyCode}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(company.companyCode!);
                    setCodeCopied(true);
                    toast.success(t("company.toast.codeCopied"));
                    setTimeout(() => setCodeCopied(false), 2000);
                  }}
                  className="p-[10px] rounded-[5px] border border-border bg-surface-input hover:bg-fill-neutral-dim transition-colors"
                >
                  {codeCopied ? (
                    <Check className="w-[16px] h-[16px] text-olive" />
                  ) : (
                    <Copy className="w-[16px] h-[16px] text-text-3" />
                  )}
                </button>
              </div>
              <p className="font-mono text-micro text-text-mute">
                {t("company.companyCodeHint")}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-0.5">
            <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
              {t("company.address")}
            </label>
            <div className="flex gap-1">
              <Input value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} className="flex-1" />
              <button
                type="button"
                onClick={async () => {
                  const addr = await getAddress();
                  if (addr) setCompanyAddress(addr);
                }}
                disabled={locating}
                className="flex items-center justify-center w-[36px] shrink-0 rounded-[5px] border border-border bg-surface-input text-text-3 hover:text-text hover:border-[rgba(255,255,255,0.18)] transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                title={t("company.useLocation")}
                aria-label={t("company.useLocationAria")}
              >
                {locating ? (
                  <Loader2 className="w-[16px] h-[16px] animate-spin" />
                ) : (
                  <Crosshair className="w-[16px] h-[16px]" />
                )}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <Input label={t("company.phone")} type="tel" value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} placeholder={t("company.phonePlaceholder")} />
            <Input label={t("company.email")} type="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} placeholder={t("company.emailPlaceholder")} />
          </div>
          <Input label={t("company.website")} type="url" value={companyWebsite} onChange={(e) => setCompanyWebsite(e.target.value)} placeholder={t("company.websitePlaceholder")} />
          <div className="flex flex-col gap-0.5">
            <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
              {t("company.description")}
            </label>
            <Textarea
              value={companyDescription}
              onChange={(e) => setCompanyDescription(e.target.value)}
              placeholder={t("company.descriptionPlaceholder")}
              rows={3}
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
              {t("company.businessHours")}
            </label>
            <div className="flex items-center gap-1.5">
              <Input value={openHour} onChange={(e) => setOpenHour(e.target.value)} placeholder={t("company.hoursStartPlaceholder")} className="flex-1" />
              <span className="font-mohave text-body text-text-3 shrink-0">{t("company.hoursSeparator")}</span>
              <Input value={closeHour} onChange={(e) => setCloseHour(e.target.value)} placeholder={t("company.hoursEndPlaceholder")} className="flex-1" />
            </div>
          </div>

          {/* ── Industries ────────────────────────────────────── */}
          <IndustryPicker
            industries={industries}
            setIndustries={setIndustries}
            search={industrySearch}
            setSearch={setIndustrySearch}
            disabled={!can("settings.company")}
          />

          {/* ── Company Size & Age — side by side ─────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
                <span className="text-text-mute">{"// "}</span>
                {t("company.teamSize")}
              </span>
              <SegmentControl
                className={cn(
                  "h-auto flex-wrap",
                  !can("settings.company") && "pointer-events-none opacity-40",
                )}
                options={teamSizeOptions}
                value={companySize}
                onChange={(v) => {
                  if (!can("settings.company")) return;
                  setCompanySize(v);
                }}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
                <span className="text-text-mute">{"// "}</span>
                {t("company.yearsInBusiness")}
              </span>
              <SegmentControl
                className={cn(
                  "h-auto flex-wrap",
                  !can("settings.company") && "pointer-events-none opacity-40",
                )}
                options={companyAgeOptions}
                value={companyAge}
                onChange={(v) => {
                  if (!can("settings.company")) return;
                  setCompanyAge(v);
                }}
              />
            </div>
          </div>

          <div className="pt-1">
            <Button variant="primary" onClick={handleSave} loading={updateCompany.isPending} className="gap-[6px]">
              <Save className="w-[16px] h-[16px]" />
              {t("company.save")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
