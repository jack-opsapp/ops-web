"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Save, Search, DollarSign, User, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EntityPicker } from "@/components/ui/entity-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateOpportunity, useClients } from "@/lib/hooks";
import { OpportunityStage, OpportunitySource, OpportunityPriority } from "@/lib/types/pipeline";
import type { Client } from "@/lib/types/models";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useDictionary } from "@/i18n/client";
import { toast } from "sonner";

// ─── Form Schema ─────────────────────────────────────────────────────────────

const leadFormSchema = z.object({
  contactName: z.string().min(1, "Contact name is required").max(200),
  title: z.string().min(1, "Deal title is required").max(200),
  contactEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  contactPhone: z.string().max(30).optional().or(z.literal("")),
  clientId: z.string().nullable(),
  source: z.union([z.nativeEnum(OpportunitySource), z.literal("")]).transform((v) => v || null),
  estimatedValue: z.number().nullable(),
  priority: z.union([z.nativeEnum(OpportunityPriority), z.literal("")]).transform((v) => v || null),
  expectedCloseDate: z.string().optional().or(z.literal("")),
  description: z.string().max(2000).optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
});

type LeadFormData = z.infer<typeof leadFormSchema>;

const sourceOptions: { value: OpportunitySource; label: string }[] = [
  { value: OpportunitySource.Referral, label: "Referral" },
  { value: OpportunitySource.Website, label: "Website" },
  { value: OpportunitySource.Phone, label: "Phone" },
  { value: OpportunitySource.SocialMedia, label: "Social Media" },
  { value: OpportunitySource.Email, label: "Email" },
  { value: OpportunitySource.WalkIn, label: "Walk-In" },
  { value: OpportunitySource.RepeatClient, label: "Repeat Client" },
  { value: OpportunitySource.Other, label: "Other" },
];

const priorityOptions: { value: OpportunityPriority; label: string }[] = [
  { value: OpportunityPriority.Low, label: "Low" },
  { value: OpportunityPriority.Medium, label: "Medium" },
  { value: OpportunityPriority.High, label: "High" },
];

// ─── Phone Formatter ────────────────────────────────────────────────────────

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

// ─── Client Selector ────────────────────────────────────────────────────────
//
// On the canonical EntityPicker (previously a hand-rolled absolute dropdown —
// the Picker kit docstring mandates the shared shell). The trigger keeps the
// form's 36px field look; the panel is the compact canonical popover.
// `z-modal` because the form mounts inside a FloatingWindow (z 2000+, above
// the kit's default `z-dropdown` 1000).

function ClientSelector({
  value,
  onChange,
  clients,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  clients: Client[];
}) {
  const { t } = useDictionary("pipeline");
  const { t: tp } = useDictionary("picker");
  const selected = clients.find((c) => c.id === value) ?? null;

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-mohave text-caption-sm text-text-3 uppercase tracking-[0.08em]">
        {t("createLead.client.label")}
      </label>
      <EntityPicker<Client>
        trigger={
          <button
            type="button"
            className={cn(
              "flex w-full min-h-[36px] items-center justify-between gap-2 px-2",
              "font-mohave text-body text-left",
              "bg-surface-input rounded border border-glass-border",
              "transition-colors duration-150",
              "hover:border-glass-border-medium",
              "focus:outline-none focus:border-glass-border-strong",
              selected ? "text-text" : "text-text-3",
            )}
          >
            <span className="truncate">
              {selected ? selected.name : t("createLead.client.linkPlaceholder")}
            </span>
            <Search className="w-[16px] h-[16px] shrink-0 text-text-3" strokeWidth={1.5} />
          </button>
        }
        label={t("table.cell.client.title")}
        items={clients}
        value={value}
        onChange={onChange}
        getId={(c) => c.id}
        getLabel={(c) => c.name}
        searchPlaceholder={t("table.cell.client.search")}
        clearLabel={tp("clear")}
        emptyLabel={t("table.cell.client.empty")}
        noneOption
        noneLabel={t("table.cell.client.none")}
        contentClassName="z-modal"
      />
    </div>
  );
}

// ─── Extracted Form Component ─────────────────────────────────────────────────

interface CreateLeadFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function CreateLeadForm({ onSuccess, onCancel }: CreateLeadFormProps) {
  const { t } = useDictionary("pipeline");
  const { company, currentUser } = useAuthStore();
  const companyId = company?.id ?? "";
  const can = usePermissionStore((s) => s.can);

  const { data: clientsData } = useClients();
  const clients = clientsData?.clients ?? [];
  const createOpportunity = useCreateOpportunity();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<LeadFormData>({
    resolver: zodResolver(leadFormSchema),
    defaultValues: {
      contactName: "",
      title: "",
      contactEmail: "",
      contactPhone: "",
      clientId: null,
      source: null,
      estimatedValue: null,
      priority: null,
      expectedCloseDate: "",
      description: "",
      address: "",
    },
  });

  // Auto-generate title from contact name
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);

  const handleContactNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setValue("contactName", value);
    if (!titleManuallyEdited && value.trim()) {
      setValue("title", `${value} - ${t("quickAdd.leadSuffix")}`, { shouldDirty: true });
    }
  };

  const phoneValue = watch("contactPhone");
  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    const formatted = formatPhoneInput(e.target.value);
    setValue("contactPhone", formatted, { shouldValidate: false });
  }

  async function onSubmit(data: LeadFormData) {
    if (!can("pipeline.manage")) return;
    if (!companyId) {
      toast.error("No company found. Please sign in again.");
      return;
    }

    createOpportunity.mutate(
      {
        companyId,
        clientId: data.clientId ?? null,
        title: data.title,
        description: data.description || null,
        contactName: data.contactName,
        contactEmail: data.contactEmail || null,
        contactPhone: data.contactPhone || null,
        stage: OpportunityStage.NewLead,
        source: data.source ?? null,
        assignedTo: currentUser?.id ?? null,
        priority: data.priority ?? null,
        estimatedValue: data.estimatedValue ?? null,
        actualValue: null,
        winProbability: 10,
        expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
        actualCloseDate: null,
        projectId: null,
        lostReason: null,
        lostNotes: null,
        quoteDeliveryMethod: null,
        address: data.address || null,
        latitude: null,
        longitude: null,
        tags: [],
      },
      {
        onSuccess: () => {
          toast.success(t("toast.newLeadCreated"), {
            description: data.title,
          });
          reset();
          onSuccess?.();
        },
        onError: (err) => {
          toast.error(t("toast.failedCreateLead"), {
            description: err instanceof Error ? err.message : t("toast.errorOccurred"),
          });
        },
      }
    );
  }

  const isSaving = createOpportunity.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
      {/* Contact Info */}
      <div className="space-y-2">
        <span className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
          Contact
        </span>
        <Input
          label="Contact Name *"
          placeholder="Full name"
          prefixIcon={<User className="w-[16px] h-[16px]" />}
          {...register("contactName")}
          onChange={handleContactNameChange}
          error={errors.contactName?.message}
        />
        <Input
          label="Deal Title *"
          placeholder="e.g., Smith Kitchen Reno"
          {...register("title", {
            onChange: () => setTitleManuallyEdited(true),
          })}
          error={errors.title?.message}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            label="Email"
            type="email"
            placeholder="contact@email.com"
            prefixIcon={<Mail className="w-[16px] h-[16px]" />}
            {...register("contactEmail")}
            error={errors.contactEmail?.message}
          />
          <Input
            label="Phone"
            type="tel"
            placeholder="(555) 123-4567"
            prefixIcon={<Phone className="w-[16px] h-[16px]" />}
            value={phoneValue || ""}
            onChange={handlePhoneChange}
          />
        </div>
      </div>

      {/* Deal Details */}
      <div className="space-y-2 pt-1 border-t border-[rgba(255,255,255,0.15)]">
        <span className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
          Deal Details
        </span>

        <ClientSelector
          value={watch("clientId")}
          onChange={(id) => {
            setValue("clientId", id, { shouldDirty: true });
            // When a client is linked, prefill the contact fields with the
            // client's saved details so the operator doesn't have to retype
            // information that already lives in the client record. Empty
            // form fields are filled in; fields the user has already touched
            // (i.e. non-empty) are preserved so we never overwrite work.
            if (!id) return;
            const client = clients.find((c) => c.id === id);
            if (!client) return;
            const currentName = watch("contactName");
            const currentEmail = watch("contactEmail");
            const currentPhone = watch("contactPhone");
            const currentAddress = watch("address");
            const currentTitle = watch("title");
            if (!currentName.trim() && client.name) {
              setValue("contactName", client.name, { shouldDirty: true });
              // Mirror the auto-title behaviour that the contactName input's
              // onChange handler provides for typed input.
              if (!titleManuallyEdited && !currentTitle.trim()) {
                setValue(
                  "title",
                  `${client.name} - ${t("quickAdd.leadSuffix")}`,
                  { shouldDirty: true }
                );
              }
            }
            if (!currentEmail?.trim() && client.email) {
              setValue("contactEmail", client.email, { shouldDirty: true });
            }
            if (!currentPhone?.trim() && client.phoneNumber) {
              setValue(
                "contactPhone",
                formatPhoneInput(client.phoneNumber),
                { shouldDirty: true }
              );
            }
            if (!currentAddress?.trim() && client.address) {
              setValue("address", client.address, { shouldDirty: true });
            }
          }}
          clients={clients}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5">
            <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
              Source
            </label>
            <select
              {...register("source")}
              className="w-full bg-fill-neutral-dim border border-border rounded px-2 py-1.5 font-mohave text-body text-text"
            >
              <option value="">Select source...</option>
              {sourceOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
              Priority
            </label>
            <select
              {...register("priority")}
              className="w-full bg-fill-neutral-dim border border-border rounded px-2 py-1.5 font-mohave text-body text-text"
            >
              <option value="">Select priority...</option>
              {priorityOptions.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            label="Estimated Value"
            type="number"
            placeholder="0.00"
            prefixIcon={<DollarSign className="w-[16px] h-[16px]" />}
            {...register("estimatedValue", {
              setValueAs: (v) => (v === "" || v === undefined ? null : parseFloat(v)),
            })}
          />
          <Input
            label="Expected Close Date"
            type="date"
            {...register("expectedCloseDate")}
          />
        </div>

        <Input
          label="Address"
          placeholder="Job site address (optional)"
          {...register("address")}
        />
      </div>

      {/* Notes */}
      <div className="pt-1 border-t border-[rgba(255,255,255,0.15)]">
        <Textarea
          label="Notes"
          placeholder="Any details about this lead..."
          {...register("description")}
          rows={3}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1 pt-1">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={isSaving} className="gap-[6px]">
          <Save className="w-[16px] h-[16px]" />
          Add Lead
        </Button>
      </div>
    </form>
  );
}

// The old `CreateLeadModal` Dialog wrapper was removed 2026-07-02: the form's
// one real mount is the "create-lead" FloatingWindow in dashboard-layout, and
// the wrapper had no consumers.
