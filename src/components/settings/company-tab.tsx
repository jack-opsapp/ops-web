"use client";

import { useState, useEffect, useRef } from "react";
import { Building2, Save, Upload, Loader2, Copy, Check, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany, useUpdateCompany, useImageUpload } from "@/lib/hooks";
import { useGeolocationAddress } from "@/lib/hooks/use-geolocation-address";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";

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
            <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
              {t("company.logo")}
            </label>
            <div className="flex items-center gap-1.5">
              <div className="w-[56px] h-[56px] rounded-lg bg-background-elevated border border-border flex items-center justify-center overflow-hidden">
                {company?.logoURL ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={company.logoURL}
                    alt="Company logo"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Building2 className="w-[24px] h-[24px] text-text-disabled" />
                )}
              </div>
              <Button variant="secondary" size="sm" className="gap-[6px]" disabled={!can("settings.company")} onClick={() => logoInputRef.current?.click()}>
                <Upload className="w-[14px] h-[14px]" />
                {t("company.upload")}
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
              <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
                {t("company.companyCode")}
              </label>
              <div className="flex items-center gap-1">
                <div className="flex-1 flex items-center px-1.5 py-[10px] rounded-sm border border-border bg-background-elevated">
                  <span className="font-mono text-body-sm text-text-primary tracking-wider">
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
                  className="p-[10px] rounded-sm border border-border bg-background-input hover:bg-background-elevated transition-colors"
                >
                  {codeCopied ? (
                    <Check className="w-[16px] h-[16px] text-status-success" />
                  ) : (
                    <Copy className="w-[16px] h-[16px] text-text-tertiary" />
                  )}
                </button>
              </div>
              <p className="font-kosugi text-[10px] text-text-disabled">
                {t("company.companyCodeHint")}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-0.5">
            <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
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
                className="flex items-center justify-center w-[36px] shrink-0 rounded border border-border bg-background-input text-text-tertiary hover:text-ops-accent hover:border-ops-accent transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
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
            <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
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
            <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
              {t("company.businessHours")}
            </label>
            <div className="flex items-center gap-1.5">
              <Input value={openHour} onChange={(e) => setOpenHour(e.target.value)} placeholder={t("company.hoursStartPlaceholder")} className="flex-1" />
              <span className="font-mohave text-body text-text-tertiary shrink-0">to</span>
              <Input value={closeHour} onChange={(e) => setCloseHour(e.target.value)} placeholder={t("company.hoursEndPlaceholder")} className="flex-1" />
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
