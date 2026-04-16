"use client";

import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Save, Search, X, DollarSign, User, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils/cn";
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

function ClientSelector({
  value,
  onChange,
  clients,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  clients: Client[];
}) {
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const filtered = useMemo(
    () => clients.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())),
    [clients, search]
  );

  const selected = clients.find((c) => c.id === value);

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
        Existing Client
      </label>
      <div className="relative">
        {selected ? (
          <div className="flex items-center justify-between bg-surface-input border border-[rgba(255,255,255,0.2)] rounded px-1.5 py-1.5">
            <span className="font-mohave text-body text-text">{selected.name}</span>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setSearch("");
              }}
              className="text-text-3 hover:text-text-2"
            >
              <X className="w-[16px] h-[16px]" />
            </button>
          </div>
        ) : (
          <div>
            <Input
              placeholder="Link to existing client (optional)..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              prefixIcon={<Search className="w-[16px] h-[16px]" />}
            />
            {showDropdown && clients.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-[4px] bg-[rgba(13,13,13,0.9)] backdrop-blur-xl border border-[rgba(255,255,255,0.2)] rounded shadow-floating max-h-[200px] overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="px-1.5 py-1 text-left">
                    <p className="font-mohave text-body-sm text-text-3">No matching clients</p>
                  </div>
                ) : (
                  filtered.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onMouseDown={() => {
                        onChange(client.id);
                        setShowDropdown(false);
                        setSearch("");
                      }}
                      className="w-full px-1.5 py-1 text-left font-mohave text-body text-text-2 hover:text-text hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                    >
                      {client.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
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
    control,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty },
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
  const contactName = watch("contactName");
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
        <span className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
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
        <span className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
          Deal Details
        </span>

        <ClientSelector
          value={watch("clientId")}
          onChange={(id) => setValue("clientId", id)}
          clients={clients}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5">
            <label className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
              Source
            </label>
            <select
              {...register("source")}
              className="w-full bg-background-elevated border border-border rounded px-2 py-1.5 font-mohave text-body text-text"
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
            <label className="font-kosugi text-caption-sm text-text-2 uppercase tracking-widest">
              Priority
            </label>
            <select
              {...register("priority")}
              className="w-full bg-background-elevated border border-border rounded px-2 py-1.5 font-mohave text-body text-text"
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

// ─── Modal Component (thin wrapper) ──────────────────────────────────────────

interface CreateLeadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateLeadModal({ open, onOpenChange }: CreateLeadModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-wider">New Lead</DialogTitle>
          <DialogDescription>Add a new lead to your pipeline.</DialogDescription>
        </DialogHeader>
        <CreateLeadForm
          onSuccess={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
