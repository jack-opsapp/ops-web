"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Save,
  Mail,
  Phone,
  MapPin,
  User,
  Building2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useCreateClient } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";

// ─── Validation Schema ───────────────────────────────────────────────────────

const phoneSchema = z
  .string()
  .optional()
  .transform((val) => {
    if (!val || val.trim() === "") return undefined;
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
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  if (digits.length <= 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1"))
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return value;
}

// ─── Modal Component ─────────────────────────────────────────────────────────

interface CreateClientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateClientModal({ open, onOpenChange }: CreateClientModalProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const { company } = useAuthStore();
  const createClient = useCreateClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    setValue,
    watch,
    reset,
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
        onSuccess: () => {
          toast.success("Client created successfully");
          reset();
          onOpenChange(false);
        },
        onError: () => {
          setServerError("Failed to create client. Please try again.");
          toast.error("Failed to create client");
        },
      }
    );
  }

  function handleClose() {
    if (!createClient.isPending) {
      reset();
      setServerError(null);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-wider">New Client</DialogTitle>
          <DialogDescription>Add a new client or company to your contacts.</DialogDescription>
        </DialogHeader>

        {serverError && (
          <div className="flex items-center gap-1.5 bg-ops-error-muted border border-ops-error/30 rounded px-1.5 py-1 animate-slide-up">
            <AlertCircle className="w-[16px] h-[16px] text-ops-error shrink-0" />
            <p className="font-mohave text-body-sm text-ops-error">{serverError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
          {/* Basic Info */}
          <div className="space-y-2">
            <span className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
              Basic Info
            </span>
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
          </div>

          {/* Contact Details */}
          <div className="space-y-2 pt-1 border-t border-[rgba(255,255,255,0.15)]">
            <span className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
              Contact Details
            </span>
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
            />
            <Input
              label="Address"
              placeholder="123 Main Street, City, State ZIP"
              prefixIcon={<MapPin className="w-[16px] h-[16px]" />}
              {...register("address")}
            />
          </div>

          {/* Notes */}
          <div className="pt-1 border-t border-[rgba(255,255,255,0.15)]">
            <Textarea
              label="Notes"
              placeholder="Any notes about this client..."
              {...register("notes")}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
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
              Create Client
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
