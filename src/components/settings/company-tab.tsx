"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Building2, Save, Upload, Loader2, Copy, Check, Crosshair, Search, X } from "lucide-react";
import { INDUSTRIES } from "@/lib/data/industries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <label className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
        Industries
      </label>

      {/* Selected tags */}
      {industries.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {industries.map((ind) => (
            <button
              key={ind}
              type="button"
              disabled={disabled}
              onClick={() => toggle(ind)}
              className="flex items-center gap-[4px] px-[8px] py-[3px] rounded-sm border border-ops-accent/40 bg-ops-accent/12 text-ops-accent font-mohave text-caption transition-colors hover:bg-ops-accent/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {ind}
              <X className="w-[10px] h-[10px]" />
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-[6px] px-1.5 py-[6px] rounded-sm border border-border bg-surface-input">
        <Search className="w-[14px] h-[14px] text-text-mute shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search trades..."
          className="flex-1 bg-transparent text-text font-mohave text-body-sm placeholder:text-text-mute outline-none"
        />
        {search && (
          <button type="button" onClick={() => setSearch("")} className="text-text-mute hover:text-text-3">
            <X className="w-[12px] h-[12px]" />
          </button>
        )}
      </div>

      {/* Scrollable options grid */}
      <div className="max-h-[180px] overflow-y-auto scrollbar-hide rounded-sm border border-border bg-surface-input/50 p-1">
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
                  "px-[8px] py-[3px] rounded-sm font-mohave text-caption transition-colors border disabled:opacity-40 disabled:cursor-not-allowed",
                  isSelected
                    ? "bg-ops-accent/20 border-ops-accent text-ops-accent"
                    : "bg-transparent border-border text-text-3 hover:text-text-2 hover:border-[rgba(255,255,255,0.18)]"
                )}
              >
                {ind}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <span className="font-kosugi text-[11px] text-text-mute px-1 py-2">
              No trades found
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

  if (isCompanyLoading && !company) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-[24px] h-[24px] text-ops-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>{t("company.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-col gap-0.5">
            <label className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
              {t("company.logo")}
            </label>
            <div className="flex items-center gap-1.5">
              <div className="relative w-[56px] h-[56px] rounded-lg bg-fill-neutral-dim border border-border flex items-center justify-center overflow-hidden">
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
                      <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
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
                  <Building2 className="w-[24px] h-[24px] text-text-mute" />
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
              <label className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
                {t("company.companyCode")}
              </label>
              <div className="flex items-center gap-1">
                <div className="flex-1 flex items-center px-1.5 py-[10px] rounded-sm border border-border bg-fill-neutral-dim">
                  <span className="font-mono text-body-sm text-text tracking-wider">
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
                  className="p-[10px] rounded-sm border border-border bg-surface-input hover:bg-fill-neutral-dim transition-colors"
                >
                  {codeCopied ? (
                    <Check className="w-[16px] h-[16px] text-status-success" />
                  ) : (
                    <Copy className="w-[16px] h-[16px] text-text-3" />
                  )}
                </button>
              </div>
              <p className="font-kosugi text-micro text-text-mute">
                {t("company.companyCodeHint")}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-0.5">
            <label className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
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
                className="flex items-center justify-center w-[36px] shrink-0 rounded border border-border bg-surface-input text-text-3 hover:text-ops-accent hover:border-ops-accent transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Use my location"
                aria-label="Auto-fill address from current location"
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
            <label className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
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
            <label className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
              {t("company.businessHours")}
            </label>
            <div className="flex items-center gap-1.5">
              <Input value={openHour} onChange={(e) => setOpenHour(e.target.value)} placeholder={t("company.hoursStartPlaceholder")} className="flex-1" />
              <span className="font-mohave text-body text-text-3 shrink-0">to</span>
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
              <label className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
                Team Size
              </label>
              <div className="flex gap-1">
                {["1-5", "6-15", "16-50", "51-200", "200+"].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    disabled={!can("settings.company")}
                    onClick={() => setCompanySize(opt)}
                    className={cn(
                      "flex-1 px-2 py-[6px] rounded-sm font-mohave text-body-sm transition-colors border disabled:opacity-40 disabled:cursor-not-allowed",
                      companySize === opt
                        ? "bg-ops-accent/20 border-ops-accent text-ops-accent"
                        : "bg-transparent border-border text-text-3 hover:text-text-2"
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
                Years in Business
              </label>
              <div className="flex gap-1">
                {[
                  { label: "<1 yr", value: "Less than 1 year" },
                  { label: "1-3 yr", value: "1-3 years" },
                  { label: "3-5 yr", value: "3-5 years" },
                  { label: "5-10 yr", value: "5-10 years" },
                  { label: "10+", value: "10+" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={!can("settings.company")}
                    onClick={() => setCompanyAge(opt.value)}
                    className={cn(
                      "flex-1 px-2 py-[6px] rounded-sm font-mohave text-body-sm transition-colors border disabled:opacity-40 disabled:cursor-not-allowed",
                      companyAge === opt.value
                        ? "bg-ops-accent/20 border-ops-accent text-ops-accent"
                        : "bg-transparent border-border text-text-3 hover:text-text-2"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-1">
            <Button onClick={handleSave} loading={updateCompany.isPending} className="gap-[6px]">
              <Save className="w-[16px] h-[16px]" />
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
