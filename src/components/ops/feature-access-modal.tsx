"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { X, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/lib/store/auth-store";
import { useCompany, useUpdateCompany } from "@/lib/hooks";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";

// ─── Options ───────────────────────────────────────────────────────
const INDUSTRY_OPTIONS = [
  "General Contracting",
  "Plumbing",
  "Electrical",
  "HVAC",
  "Roofing",
  "Landscaping",
  "Painting",
  "Flooring",
  "Concrete",
  "Demolition",
  "Excavation",
  "Fencing",
  "Framing",
  "Insulation",
  "Masonry",
  "Solar",
  "Welding",
  "Windows & Doors",
];

const SIZE_OPTIONS = ["1-5", "6-15", "16-50", "51-200", "200+"];
const AGE_OPTIONS = ["Less than 1 year", "1-3 years", "3-5 years", "5-10 years", "10+"];

// ─── Completeness ──────────────────────────────────────────────────
interface CompanyFields {
  name: string;
  industries: string[];
  companySize: string;
  companyAge: string;
  address: string;
  phone: string;
  email: string;
}

function isProfileComplete(f: CompanyFields): boolean {
  return !!(
    f.name?.trim() &&
    f.industries?.length > 0 &&
    f.companySize?.trim() &&
    f.companyAge?.trim() &&
    f.address?.trim() &&
    f.phone?.trim() &&
    f.email?.trim()
  );
}

// ─── Props ─────────────────────────────────────────────────────────
interface FeatureAccessModalProps {
  open: boolean;
  onClose: () => void;
  featureLabel: string;
  featureSlug: string;
  alreadyRequested: boolean;
  onRequestSubmitted: () => void;
}

export function FeatureAccessModal({
  open,
  onClose,
  featureLabel,
  featureSlug,
  alreadyRequested,
  onRequestSubmitted,
}: FeatureAccessModalProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { data: company } = useCompany();
  const updateCompany = useUpdateCompany();

  // Local form state
  const [industries, setIndustries] = useState<string[]>([]);
  const [companySize, setCompanySize] = useState("");
  const [companyAge, setCompanyAge] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Sync company data when modal opens
  useEffect(() => {
    if (open && company) {
      setIndustries(company.industries ?? []);
      setCompanySize(company.companySize ?? "");
      setCompanyAge(company.companyAge ?? "");
      setAddress(company.address ?? "");
      setPhone(company.phone ?? "");
      setEmail(company.email ?? "");
      setSuccess(false);
      setSubmitting(false);
    }
  }, [open, company]);

  const formFields: CompanyFields = useMemo(
    () => ({
      name: company?.name ?? "",
      industries,
      companySize,
      companyAge,
      address,
      phone,
      email,
    }),
    [company?.name, industries, companySize, companyAge, address, phone, email]
  );

  const profileComplete = useMemo(() => isProfileComplete(formFields), [formFields]);

  const toggleIndustry = useCallback((ind: string) => {
    setIndustries((prev) =>
      prev.includes(ind) ? prev.filter((i) => i !== ind) : [...prev, ind]
    );
  }, []);

  async function handleSubmit() {
    if (!currentUser || !company) return;
    setSubmitting(true);

    try {
      // Save company profile updates if any fields changed
      const updates: Record<string, unknown> = {};
      if (JSON.stringify(industries) !== JSON.stringify(company.industries ?? []))
        updates.industries = industries;
      if (companySize !== (company.companySize ?? "")) updates.companySize = companySize;
      if (companyAge !== (company.companyAge ?? "")) updates.companyAge = companyAge;
      if (address !== (company.address ?? "")) updates.address = address;
      if (phone !== (company.phone ?? "")) updates.phone = phone;
      if (email !== (company.email ?? "")) updates.email = email;

      if (Object.keys(updates).length > 0) {
        await new Promise<void>((resolve, reject) => {
          updateCompany.mutate(
            { id: company.id, data: updates },
            { onSuccess: () => resolve(), onError: reject }
          );
        });
      }

      // Submit the access request
      const res = await fetch("/api/whats-new/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: currentUser.id,
          user_email: currentUser.email,
          user_name: `${currentUser.firstName ?? ""} ${currentUser.lastName ?? ""}`.trim(),
          company_id: company.id,
          company_name: company.name,
          feature_flag_slug: featureSlug,
          feature_label: featureLabel,
          company_phone: phone,
          company_address: address,
          company_size: companySize,
          company_industries: industries,
        }),
      });

      if (res.status === 409) {
        setSuccess(true);
        onRequestSubmitted();
        return;
      }

      if (!res.ok) throw new Error("Request failed");

      setSuccess(true);
      onRequestSubmitted();
    } catch (err) {
      console.error("[FeatureAccessModal] submit error:", err);
      toast.error("Failed to submit request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-[480px] max-h-[90vh] overflow-y-auto mx-4 rounded-sm border border-border bg-background-panel shadow-xl">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 text-text-tertiary hover:text-text-primary transition-colors z-10"
        >
          <X className="w-[16px] h-[16px]" />
        </button>

        <div className="p-4 space-y-3">
          {/* Header */}
          <h2 className="font-mohave text-lg text-text-primary pr-6">
            Get Early Access to {featureLabel}
          </h2>

          {/* ─── Success State ─── */}
          {success && (
            <div className="flex flex-col items-center gap-2 py-4">
              <CheckCircle2 className="w-[40px] h-[40px] text-status-success" />
              <p className="font-mohave text-body text-text-primary text-center">
                {"You're on the list!"}
              </p>
              <p className="font-kosugi text-caption text-text-secondary text-center">
                {"We'll review your request and get back to you."}
              </p>
              <Button variant="secondary" onClick={onClose} className="mt-2">
                Close
              </Button>
            </div>
          )}

          {/* ─── Already Requested ─── */}
          {!success && alreadyRequested && (
            <div className="flex flex-col items-center gap-2 py-4">
              <CheckCircle2 className="w-[40px] h-[40px] text-ops-accent" />
              <p className="font-mohave text-body text-text-primary text-center">
                {"You've already requested access to"} {featureLabel}.
              </p>
              <p className="font-kosugi text-caption text-text-secondary text-center">
                {"We'll be in touch!"}
              </p>
              <Button variant="secondary" onClick={onClose} className="mt-2">
                Close
              </Button>
            </div>
          )}

          {/* ─── Request Form ─── */}
          {!success && !alreadyRequested && (
            <>
              <p className="font-kosugi text-caption text-text-secondary">
                {profileComplete
                  ? "This feature is currently in development. Want to be added to the pre-release testing list?"
                  : "To request access, please complete your company information below."}
              </p>

              {/* User info (read-only) */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-kosugi text-caption-sm text-text-disabled uppercase w-[60px]">Name</span>
                  <span className="font-mohave text-body-sm text-text-primary">
                    {currentUser ? `${currentUser.firstName ?? ""} ${currentUser.lastName ?? ""}`.trim() : "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-kosugi text-caption-sm text-text-disabled uppercase w-[60px]">Email</span>
                  <span className="font-mohave text-body-sm text-text-primary">
                    {currentUser?.email ?? "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-kosugi text-caption-sm text-text-disabled uppercase w-[60px]">Company</span>
                  <span className="font-mohave text-body-sm text-text-primary">
                    {company?.name ?? "—"}
                  </span>
                </div>
              </div>

              {/* Editable company fields */}
              <div className="space-y-2 pt-1 border-t border-border">
                {/* Industries */}
                <div className="flex flex-col gap-0.5">
                  <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
                    Industry {industries.length === 0 && <span className="text-ops-error">*</span>}
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {INDUSTRY_OPTIONS.map((ind) => (
                      <button
                        key={ind}
                        type="button"
                        onClick={() => toggleIndustry(ind)}
                        className={cn(
                          "px-2 py-0.5 rounded-sm text-caption font-mohave transition-colors border",
                          industries.includes(ind)
                            ? "bg-ops-accent/20 border-ops-accent text-ops-accent"
                            : "bg-transparent border-border text-text-tertiary hover:text-text-secondary hover:border-text-tertiary"
                        )}
                      >
                        {ind}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Company Size */}
                <div className="flex flex-col gap-0.5">
                  <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
                    Company Size {!companySize && <span className="text-ops-error">*</span>}
                  </label>
                  <div className="flex gap-1">
                    {SIZE_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setCompanySize(opt)}
                        className={cn(
                          "flex-1 px-2 py-1 rounded-sm text-caption font-mohave transition-colors border",
                          companySize === opt
                            ? "bg-ops-accent/20 border-ops-accent text-ops-accent"
                            : "bg-transparent border-border text-text-tertiary hover:text-text-secondary"
                        )}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Company Age */}
                <div className="flex flex-col gap-0.5">
                  <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
                    Company Age {!companyAge && <span className="text-ops-error">*</span>}
                  </label>
                  <div className="flex gap-1 flex-wrap">
                    {AGE_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setCompanyAge(opt)}
                        className={cn(
                          "px-2 py-1 rounded-sm text-caption font-mohave transition-colors border",
                          companyAge === opt
                            ? "bg-ops-accent/20 border-ops-accent text-ops-accent"
                            : "bg-transparent border-border text-text-tertiary hover:text-text-secondary"
                        )}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Address, Phone, Email */}
                <Input
                  label={`Address${!address ? " *" : ""}`}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="123 Main St, City, State"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    label={`Phone${!phone ? " *" : ""}`}
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                  />
                  <Input
                    label={`Business Email${!email ? " *" : ""}`}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="info@company.com"
                  />
                </div>
              </div>

              {/* Submit */}
              <div className="pt-1">
                <Button
                  onClick={handleSubmit}
                  disabled={!profileComplete || submitting}
                  className="w-full gap-1"
                >
                  {submitting && <Loader2 className="w-[14px] h-[14px] animate-spin" />}
                  {profileComplete ? "Request Access" : "Save & Request Access"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
