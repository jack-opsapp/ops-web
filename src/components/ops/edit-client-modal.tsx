"use client";

import { useState, useEffect, useMemo } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Save,
  Mail,
  Phone,
  User,
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
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useUpdateClient } from "@/lib/hooks";
import { AddressAutocomplete } from "@/components/forms/address-autocomplete";
import type { Client } from "@/lib/types/models";

// ─── Validation Schema ───────────────────────────────────────────────────────

const phoneSchema = z
  .string()
  .optional()
  .transform((val) => {
    if (!val || val.trim() === "") return undefined;
    const digits = val.replace(/\D/g, "");
    return digits.length > 0 ? val.trim() : undefined;
  });

const editClientSchema = z.object({
  name: z
    .string()
    .min(1, "Client name is required")
    .max(200, "Name must be 200 characters or less"),
  email: z
    .string()
    .email("Please enter a valid email address")
    .optional()
    .or(z.literal("")),
  phone: phoneSchema,
  address: z.string().optional(),
  notes: z.string().optional(),
});

type EditClientFormValues = z.infer<typeof editClientSchema>;

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

// ─── Modal ───────────────────────────────────────────────────────────────────

interface EditClientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client;
}

export function EditClientModal({ open, onOpenChange, client }: EditClientModalProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const updateClient = useUpdateClient();

  const defaults: EditClientFormValues = useMemo(
    () => ({
      name: client.name ?? "",
      email: client.email ?? "",
      phone: client.phoneNumber ?? "",
      address: client.address ?? "",
      notes: client.notes ?? "",
    }),
    [client]
  );

  const methods = useForm<EditClientFormValues>({
    resolver: zodResolver(editClientSchema),
    defaultValues: defaults,
    mode: "onBlur",
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    setValue,
    watch,
    reset,
  } = methods;

  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const phoneValue = watch("phone");

  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    const formatted = formatPhoneInput(e.target.value);
    setValue("phone", formatted, { shouldValidate: false, shouldDirty: true });
  }

  function handleClose() {
    setServerError(null);
    reset(defaults);
    onOpenChange(false);
  }

  async function onSubmit(data: EditClientFormValues) {
    setServerError(null);
    updateClient.mutate(
      {
        id: client.id,
        data: {
          name: data.name,
          email: data.email || null,
          phoneNumber: data.phone || null,
          address: data.address || null,
          notes: data.notes || null,
        },
      },
      {
        onSuccess: () => {
          toast.success("Client updated");
          onOpenChange(false);
        },
        onError: (err) => {
          const msg =
            err instanceof Error
              ? err.message
              : "Failed to update client. Please try again.";
          setServerError(msg);
          toast.error(msg);
        },
      }
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
        else onOpenChange(true);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-wider">Edit Client</DialogTitle>
          <DialogDescription>
            Update contact details, address, and notes.
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          {serverError && (
            <div className="flex items-center gap-1.5 bg-ops-error-muted border border-ops-error/30 rounded px-1.5 py-1 animate-slide-up">
              <AlertCircle className="w-[16px] h-[16px] text-ops-error shrink-0" />
              <p className="font-mohave text-body-sm text-ops-error">{serverError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
            <div className="space-y-2">
              <span className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
                Basic Info
              </span>
              <Input
                label="Client Name *"
                placeholder="Full name or company name"
                prefixIcon={<User className="w-[16px] h-[16px]" />}
                error={errors.name?.message}
                {...register("name")}
              />
            </div>

            <div className="space-y-2 pt-1 border-t border-[rgba(255,255,255,0.15)]">
              <span className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
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
              <AddressAutocomplete<EditClientFormValues>
                name="address"
                label="Address"
              />
            </div>

            <div className="pt-1 border-t border-[rgba(255,255,255,0.15)]">
              <Textarea
                label="Notes"
                placeholder="Any notes about this client..."
                {...register("notes")}
              />
            </div>

            <div className="flex items-center justify-end gap-1 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                disabled={updateClient.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                loading={updateClient.isPending}
                className="gap-[6px]"
                disabled={!isDirty}
              >
                <Save className="w-[16px] h-[16px]" />
                Save Changes
              </Button>
            </div>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
