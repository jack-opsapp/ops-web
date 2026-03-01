"use client";

import { useState, useEffect, useRef } from "react";
import { Building2, Save, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany, useUpdateCompany, useImageUpload } from "@/lib/hooks";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

export function CompanyTab() {
  const { t } = useDictionary("settings");
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
    <div className="space-y-3 max-w-[600px]">
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
              <Button variant="secondary" size="sm" className="gap-[6px]" onClick={() => logoInputRef.current?.click()}>
                <Upload className="w-[14px] h-[14px]" />
                {t("company.upload")}
              </Button>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) logoUpload.selectFile(file);
                }}
              />
            </div>
          </div>

          <Input label={t("company.name")} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          <Input label={t("company.address")} value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} />
          <Input label={t("company.phone")} type="tel" value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} placeholder={t("company.phonePlaceholder")} />
          <Input label={t("company.email")} type="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} placeholder={t("company.emailPlaceholder")} />
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
