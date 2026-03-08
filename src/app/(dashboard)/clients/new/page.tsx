"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowLeft,
  Save,
  Mail,
  Phone,
  MapPin,
  User,
  Building2,
  StickyNote,
  AlertCircle,
} from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useCreateClient } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";

// ─── Validation Schema ───────────────────────────────────────────────────────

/**
 * Phone validation that handles the quirk where phone can be
 * string OR number. We normalize everything to string and validate format.
 */
const phoneSchema = z
  .string()
  .optional()
  .transform((val) => {
    if (!val || val.trim() === "") return undefined;
    // Strip non-numeric for validation, but keep original for display
    const digits = val.replace(/\D/g, "");
    return digits.length > 0 ? val.trim() : undefined;
  });

const newClientSchema = z.object({
  name: z
    .string()
    .min(1, "Client name is required")
    .max(200, "Name must be 200 characters or less"),
  company: z.string().optional(),
  email: z
    .string()
    .email("Please enter a valid email address")
    .optional()
    .or(z.literal("")),
  phone: phoneSchema,
  address: z.string().optional(),
  notes: z.string().optional(),
});

type NewClientFormValues = z.infer<typeof newClientSchema>;

// ─── Phone Formatter ─────────────────────────────────────────────────────────

function formatPhoneInput(value: string): string {
  // Strip non-numeric
  const digits = value.replace(/\D/g, "");

  // Auto-format as user types
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  if (digits.length <= 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  // 11 digits with leading 1
  if (digits.length === 11 && digits.startsWith("1"))
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;

  return value;
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function NewClientPage() {
  const { t } = useDictionary("clients");
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const { company } = useAuthStore();
  const createClient = useCreateClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    setValue,
    watch,
  } = useForm<NewClientFormValues>({
    resolver: zodResolver(newClientSchema),
    defaultValues: {
      name: "",
      company: "",
      email: "",
      phone: "",
      address: "",
      notes: "",
    },
    mode: "onBlur",
  });

  const phoneValue = watch("phone");
  const nameValue = watch("name");

  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    const formatted = formatPhoneInput(e.target.value);
    setValue("phone", formatted, { shouldValidate: false });
  }

  async function onSubmit(data: NewClientFormValues) {
    setServerError(null);

    createClient.mutate(
      {
        name: data.name,
        email: data.email || null,
        phoneNumber: data.phone || null,
        address: data.address || null,
        notes: data.notes || null,
        companyId: company?.id ?? "",
      },
      {
        onSuccess: (newClientId) => {
          toast.success(t("toast.created"));
          router.push(`/clients/${newClientId}`);
        },
        onError: () => {
          setServerError(t("new.createFailed"));
          toast.error(t("toast.createFailed"));
        },
      }
    );
  }

  // Preview initials
  const initials = nameValue
    ? nameValue
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  return (
    <div className="max-w-[640px] space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/clients")}
        >
          <ArrowLeft className="w-[20px] h-[20px]" />
        </Button>
        <div className="flex items-center gap-1.5">
          <div className="w-[40px] h-[40px] rounded-full flex items-center justify-center shrink-0 border border-[rgba(255,255,255,0.15)]">
            <span className="font-mohave text-body-lg text-text-secondary">
              {initials}
            </span>
          </div>
          <div>
            <h1 className="font-mohave text-display text-text-primary tracking-wide">
              {t("new.heading")}
            </h1>
            <p className="font-kosugi text-caption-sm text-text-tertiary">
              {t("new.subtitle")}
            </p>
          </div>
        </div>
      </div>

      {/* Server Error */}
      {serverError && (
        <div className="flex items-center gap-1.5 bg-ops-error-muted border border-ops-error/30 rounded px-1.5 py-1 animate-slide-up">
          <AlertCircle className="w-[16px] h-[16px] text-ops-error shrink-0" />
          <p className="font-mohave text-body-sm text-ops-error">{serverError}</p>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
        {/* Basic Info Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-[6px]">
              <User className="w-[14px] h-[14px] text-text-tertiary" />
              <CardTitle>{t("new.basicInfo")}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              label={t("new.nameLabel")}
              placeholder={t("new.namePlaceholder")}
              prefixIcon={<User className="w-[16px] h-[16px]" />}
              error={errors.name?.message}
              {...register("name")}
            />
            <Input
              label={t("new.companyLabel")}
              placeholder={t("new.companyPlaceholder")}
              prefixIcon={<Building2 className="w-[16px] h-[16px]" />}
              {...register("company")}
            />
          </CardContent>
        </Card>

        {/* Contact Info Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-[6px]">
              <Phone className="w-[14px] h-[14px] text-text-tertiary" />
              <CardTitle>{t("new.contactDetails")}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              label={t("new.emailLabel")}
              type="email"
              placeholder={t("new.emailPlaceholder")}
              prefixIcon={<Mail className="w-[16px] h-[16px]" />}
              error={errors.email?.message}
              {...register("email")}
            />
            <Input
              label={t("new.phoneLabel")}
              type="tel"
              placeholder={t("new.phonePlaceholder")}
              prefixIcon={<Phone className="w-[16px] h-[16px]" />}
              value={phoneValue || ""}
              onChange={handlePhoneChange}
              helperText={t("new.phoneHelper")}
            />
            <Input
              label={t("new.addressLabel")}
              placeholder={t("new.addressPlaceholder")}
              prefixIcon={<MapPin className="w-[16px] h-[16px]" />}
              {...register("address")}
            />
          </CardContent>
        </Card>

        {/* Notes Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-[6px]">
              <StickyNote className="w-[14px] h-[14px] text-text-tertiary" />
              <CardTitle>{t("new.notes")}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder={t("new.notesPlaceholder")}
              {...register("notes")}
            />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-between pt-1">
          <p className="font-kosugi text-caption-sm text-text-disabled">
            * Required field
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/clients")}
              disabled={createClient.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={createClient.isPending}
              className="gap-[6px]"
              disabled={!isDirty}
            >
              <Save className="w-[16px] h-[16px]" />
              {t("new.createClient")}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
