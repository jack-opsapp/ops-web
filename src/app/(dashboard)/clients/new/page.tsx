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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ─── Validation Schema ───────────────────────────────────────────────────────

/**
 * Phone validation that handles the Bubble quirk where phone can be
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
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid, isDirty },
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
    setIsSaving(true);

    try {
      // TODO: Replace with useCreateClient mutation
      // const createClient = useCreateClient();
      // const newId = await createClient.mutateAsync({
      //   name: data.name,
      //   email: data.email || null,
      //   phoneNumber: data.phone || null,
      //   address: data.address || null,
      //   notes: data.notes || null,
      //   companyId: company?.id ?? "",
      // });
      await new Promise((r) => setTimeout(r, 800));

      // Redirect to the new client detail page (or list for now)
      router.push("/clients");
    } catch {
      setServerError("Failed to create client. Please try again.");
    } finally {
      setIsSaving(false);
    }
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
          <div className="w-[40px] h-[40px] rounded-full bg-ops-accent-muted flex items-center justify-center shrink-0">
            <span className="font-mohave text-body-lg text-ops-accent">
              {initials}
            </span>
          </div>
          <div>
            <h1 className="font-mohave text-display text-text-primary tracking-wide">
              NEW CLIENT
            </h1>
            <p className="font-kosugi text-caption-sm text-text-tertiary">
              Add a new client or company to your contacts
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
              <CardTitle>Basic Info</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              label="Client Name *"
              placeholder="Full name or company name"
              prefixIcon={<User className="w-[16px] h-[16px]" />}
              error={errors.name?.message}
              {...register("name")}
            />
            <Input
              label="Company"
              placeholder="Company or business name (optional)"
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
              <CardTitle>Contact Details</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              label="Email"
              type="email"
              placeholder="client@email.com"
              prefixIcon={<Mail className="w-[16px] h-[16px]" />}
              error={errors.email?.message}
              {...register("email")}
            />
            <Input
              label="Phone"
              type="tel"
              placeholder="(555) 123-4567"
              prefixIcon={<Phone className="w-[16px] h-[16px]" />}
              value={phoneValue || ""}
              onChange={handlePhoneChange}
              helperText="US format auto-applied"
            />
            <Input
              label="Address"
              placeholder="123 Main Street, City, State ZIP"
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
              <CardTitle>Notes</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Any notes about this client (gate codes, preferences, payment terms...)"
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
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isSaving}
              className="gap-[6px]"
              disabled={!isDirty}
            >
              <Save className="w-[16px] h-[16px]" />
              Create Client
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
