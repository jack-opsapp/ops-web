"use client";

import { useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Save, Search, DollarSign, User, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EntityPicker } from "@/components/ui/entity-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ops/projects/workspace/atoms/select";
import {
  AddressAutocomplete,
  type AddressSelection,
} from "@/components/ops/projects/workspace/inputs/address-autocomplete";
import { useCreateOpportunity, useClients, useCreateClient } from "@/lib/hooks";
import { OpportunityStage, OpportunitySource, OpportunityPriority } from "@/lib/types/pipeline";
import { buildLeadTitle } from "@/lib/utils/lead-title";
import type { Client } from "@/lib/types/models";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useDictionary } from "@/i18n/client";
import { toast } from "@/components/ui/toast";

// ─── Form Schema ─────────────────────────────────────────────────────────────

// Built per-render locale so zod messages come from the dictionary. No zod
// `.transform()` here — transforms split input/output types and fight RHF's
// resolver generics; instead source/priority stay `"" | Enum` (the "" sentinel
// is the cleared state) and `onSubmit` normalizes "" → null on the way out.
function buildLeadFormSchema(t: (key: string) => string) {
  return z.object({
    contactName: z.string().min(1, t("createLead.errors.contactRequired")).max(200),
    title: z.string().min(1, t("createLead.errors.titleRequired")).max(200),
    contactEmail: z
      .string()
      .email(t("createLead.errors.invalidEmail"))
      .optional()
      .or(z.literal("")),
    contactPhone: z.string().max(30).optional().or(z.literal("")),
    clientId: z.string().nullable(),
    source: z.union([z.nativeEnum(OpportunitySource), z.literal("")]),
    estimatedValue: z.number().nullable(),
    priority: z.union([z.nativeEnum(OpportunityPriority), z.literal("")]),
    description: z.string().max(2000).optional().or(z.literal("")),
    address: z.string().max(500).optional().or(z.literal("")),
  });
}

type LeadFormData = z.infer<ReturnType<typeof buildLeadFormSchema>>;

/** Manual-form source options. `voice_log` is a capture channel (iOS voice
 * notes), not something an operator picks by hand — it stays off the list. */
const SOURCE_VALUES: OpportunitySource[] = [
  OpportunitySource.Referral,
  OpportunitySource.Website,
  OpportunitySource.Phone,
  OpportunitySource.SocialMedia,
  OpportunitySource.Email,
  OpportunitySource.WalkIn,
  OpportunitySource.RepeatClient,
  OpportunitySource.Other,
];

const PRIORITY_VALUES: OpportunityPriority[] = [
  OpportunityPriority.Low,
  OpportunityPriority.Medium,
  OpportunityPriority.High,
];

/** Radix Select items cannot carry `""` — sentinel for the cleared state. */
const NONE = "__none__";

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

// ─── Section header ─────────────────────────────────────────────────────────

/** `// SECTION` — the tactical section voice (DESIGN.md §2). Slashes are
 * decorative → `text-mute`; the word carries the label color. */
function SectionHeader({ children }: { children: string }) {
  return (
    <span className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
      <span className="text-text-mute">{"// "}</span>
      {children}
    </span>
  );
}

// ─── Client Selector ────────────────────────────────────────────────────────
//
// On the canonical EntityPicker (previously a hand-rolled absolute dropdown —
// the Picker kit docstring mandates the shared shell). The trigger keeps the
// form's 36px field look; the panel is the compact canonical popover.
// `z-modal` because the form mounts inside a FloatingWindow (z 2000+, above
// the kit's default `z-dropdown` 1000). Carries the same query-seeded
// create-and-link affordance as the board card's ClientLinkControl, with the
// same duplicate guard (exact name match links instead of creating).

function ClientSelector({
  value,
  onChange,
  onCreate,
  clients,
  resolveName,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  onCreate: (name: string) => void;
  clients: Client[];
  /** Resolves a client name even before the list refetch (just-created). */
  resolveName: (id: string | null) => string | null;
}) {
  const { t } = useDictionary("pipeline");
  const { t: tp } = useDictionary("picker");
  const [open, setOpen] = useState(false);
  const selectedName = resolveName(value);
  const createLabel = t("createLead.client.create");
  const createNewLabel = t("createLead.client.createNew");

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
              selectedName ? "text-text" : "text-text-3",
            )}
          >
            <span className="truncate">
              {selectedName ?? t("createLead.client.linkPlaceholder")}
            </span>
            <Search className="w-[16px] h-[16px] shrink-0 text-text-3" strokeWidth={1.5} />
          </button>
        }
        open={open}
        onOpenChange={setOpen}
        label={t("table.cell.client.title")}
        items={clients}
        value={value}
        onChange={onChange}
        getId={(c) => c.id}
        getLabel={(c) => c.name}
        getDescription={(c) => c.email ?? undefined}
        getKeywords={(c) =>
          [c.email, c.phoneNumber, c.address].filter(
            (term): term is string => Boolean(term),
          )
        }
        searchPlaceholder={t("table.cell.client.search")}
        clearLabel={tp("clear")}
        emptyLabel={t("table.cell.client.empty")}
        noneOption
        noneLabel={t("table.cell.client.none")}
        createAction={{
          label: (query) => {
            const name = query.trim();
            return name ? `${createLabel} ${name}` : createNewLabel;
          },
          onCreate: (query) => {
            const name = query.trim();
            if (!name) return; // stay open — no name typed yet
            setOpen(false);
            onCreate(name);
          },
        }}
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
  const clients = useMemo(() => clientsData?.clients ?? [], [clientsData?.clients]);
  const createOpportunity = useCreateOpportunity();
  const createClient = useCreateClient();

  const schema = useMemo(() => buildLeadFormSchema(t), [t]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<LeadFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      contactName: "",
      title: "",
      contactEmail: "",
      contactPhone: "",
      clientId: null,
      source: "",
      estimatedValue: null,
      priority: "",
      description: "",
      address: "",
    },
  });

  // ── Derivation state ──────────────────────────────────────────────────────
  // The title names itself (`Contact (Client) - Source Lead`) until the
  // operator types their own; clearing the field hands naming back to the
  // form. The source auto-sets to `repeat_client` when an existing client is
  // linked — but only while the operator hasn't chosen one, and it un-sets
  // itself again if the client is unlinked untouched.
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);
  const sourceAutoSetRef = useRef(false);
  // Coordinates ride along only when the address came from a real geocode
  // selection (or a linked client's saved pin) — free-typed text carries none.
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  // Resolves the just-created client's name before the list refetch lands.
  const [justCreatedClient, setJustCreatedClient] = useState<Client | null>(null);

  const resolveClient = (id: string | null): Client | null => {
    if (!id) return null;
    return (
      clients.find((c) => c.id === id) ??
      (justCreatedClient?.id === id ? justCreatedClient : null)
    );
  };

  const sourceLabel = (source: string | null | undefined): string | null =>
    source ? t(`band.source.${source}`) : null;

  /** Re-derive the title from current form state (unless operator-owned).
   * Overrides exist for values set in the same tick (React state and RHF
   * writes land next render — the caller knows the freshest value). */
  const recomputeTitle = (next?: {
    contactName?: string;
    clientName?: string | null;
    source?: string | null;
  }) => {
    if (titleManuallyEdited) return;
    const contactName = next?.contactName ?? getValues("contactName");
    const clientName =
      next?.clientName !== undefined
        ? next.clientName
        : (resolveClient(getValues("clientId"))?.name ?? null);
    const source = next?.source !== undefined ? next.source : getValues("source");
    const derived = buildLeadTitle({
      contactName,
      clientName,
      sourceLabel: sourceLabel(source),
      suffix: t("quickAdd.leadSuffix"),
    });
    setValue("title", derived, { shouldDirty: true });
  };

  // ── Field handlers ────────────────────────────────────────────────────────

  const handleContactNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setValue("contactName", value);
    recomputeTitle({ contactName: value });
  };

  const phoneValue = watch("contactPhone");
  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    const formatted = formatPhoneInput(e.target.value);
    setValue("contactPhone", formatted, { shouldValidate: false });
  }

  /**
   * The one client-link cascade (link, unlink, create-and-link):
   *  - prefills EMPTY contact fields from the client record (never overwrites
   *    operator input) — including the saved pin when the address rides along;
   *  - auto-selects `repeat_client` as source while the operator hasn't
   *    picked one (editable; reverts on unlink if still untouched);
   *  - re-derives the title.
   */
  const applyClientLink = (id: string | null) => {
    setValue("clientId", id, { shouldDirty: true });
    const client = resolveClient(id);

    if (!client) {
      if (
        !id &&
        sourceAutoSetRef.current &&
        getValues("source") === OpportunitySource.RepeatClient
      ) {
        setValue("source", "", { shouldDirty: true });
        sourceAutoSetRef.current = false;
        recomputeTitle({ clientName: null, source: null });
        return;
      }
      recomputeTitle({ clientName: null });
      return;
    }

    applyClientCascade(client);
  };

  const applyClientCascade = (client: Client) => {
    if (!getValues("contactName").trim() && client.name) {
      setValue("contactName", client.name, { shouldDirty: true });
    }
    if (!getValues("contactEmail")?.trim() && client.email) {
      setValue("contactEmail", client.email, { shouldDirty: true });
    }
    if (!getValues("contactPhone")?.trim() && client.phoneNumber) {
      setValue("contactPhone", formatPhoneInput(client.phoneNumber), { shouldDirty: true });
    }
    if (!getValues("address")?.trim() && client.address) {
      setValue("address", client.address, { shouldDirty: true });
      setCoords(
        client.latitude != null && client.longitude != null
          ? { latitude: client.latitude, longitude: client.longitude }
          : null,
      );
    }

    let nextSource = getValues("source");
    if (!nextSource) {
      nextSource = OpportunitySource.RepeatClient;
      setValue("source", nextSource, { shouldDirty: true });
      sourceAutoSetRef.current = true;
    }

    recomputeTitle({ clientName: client.name, source: nextSource });
  };

  const handleCreateClient = async (name: string) => {
    // Exact-name match links instead of creating — the same duplicate guard
    // the board card's create-and-link control applies.
    const exact = clients.find(
      (c) => c.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (exact) {
      applyClientLink(exact.id);
      return;
    }
    try {
      const client = await createClient.mutateAsync({
        name,
        email: getValues("contactEmail")?.trim() || null,
        phoneNumber: getValues("contactPhone")?.trim() || null,
        address: getValues("address")?.trim() || null,
      });
      setJustCreatedClient(client);
      // State set above lands next render — cascade through the fresh object
      // so prefill/source/title see the new client NOW.
      setValue("clientId", client.id, { shouldDirty: true });
      applyClientCascade(client);
    } catch (err) {
      toast.error(t("createLead.client.createFailed"), {
        description: err instanceof Error ? err.message : t("toast.errorOccurred"),
      });
    }
  };

  const handleSourceChange = (value: string) => {
    const next = value === NONE ? "" : value;
    setValue("source", next as LeadFormData["source"], { shouldDirty: true });
    sourceAutoSetRef.current = false; // operator owns the source now
    recomputeTitle({ source: next || null });
  };

  const handleAddressSelect = (selection: AddressSelection) => {
    setValue("address", selection.address, { shouldDirty: true });
    setCoords({ latitude: selection.latitude, longitude: selection.longitude });
  };

  const handleAddressDraft = (draft: string) => {
    setValue("address", draft, { shouldDirty: true });
    setCoords(null); // typed text has no pin until a suggestion is picked
  };

  // ── Options ───────────────────────────────────────────────────────────────

  const sourceOptions = useMemo(
    () => [
      { value: NONE, label: "—" },
      ...SOURCE_VALUES.map((s) => ({ value: s as string, label: t(`band.source.${s}`) })),
    ],
    [t],
  );

  const priorityOptions = useMemo(
    () => [
      { value: NONE, label: "—" },
      ...PRIORITY_VALUES.map((p) => ({ value: p as string, label: t(`band.priority.${p}`) })),
    ],
    [t],
  );

  // ── Submit ────────────────────────────────────────────────────────────────

  function onSubmit(data: LeadFormData) {
    if (!can("pipeline.manage")) return;
    if (!companyId) {
      toast.error(t("createLead.noCompany"));
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
        source: data.source || null,
        assignedTo: currentUser?.id ?? null,
        priority: data.priority || null,
        estimatedValue: data.estimatedValue ?? null,
        actualValue: null,
        winProbability: 10,
        expectedCloseDate: null,
        actualCloseDate: null,
        projectId: null,
        lostReason: null,
        lostNotes: null,
        quoteDeliveryMethod: null,
        address: data.address || null,
        latitude: data.address?.trim() ? (coords?.latitude ?? null) : null,
        longitude: data.address?.trim() ? (coords?.longitude ?? null) : null,
        tags: [],
      },
      {
        onSuccess: () => {
          toast.success(t("toast.newLeadCreated"), {
            description: data.title,
          });
          reset();
          setTitleManuallyEdited(false);
          sourceAutoSetRef.current = false;
          setCoords(null);
          setJustCreatedClient(null);
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
      {/* ── Contact — who this lead is. Client leads (repeat business is the
             trades' bread and butter): one pick prefills everything below. */}
      <div className="space-y-2">
        <SectionHeader>{t("createLead.section.contact")}</SectionHeader>

        <ClientSelector
          value={watch("clientId")}
          onChange={(id) => applyClientLink(id)}
          onCreate={(name) => void handleCreateClient(name)}
          clients={clients}
          resolveName={(id) => resolveClient(id)?.name ?? null}
        />

        <Input
          label={`${t("createLead.contactName.label")} *`}
          placeholder={t("createLead.contactName.placeholder")}
          prefixIcon={<User className="w-[16px] h-[16px]" />}
          {...register("contactName")}
          onChange={handleContactNameChange}
          error={errors.contactName?.message}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input
            label={t("createLead.email.label")}
            type="email"
            placeholder={t("createLead.email.placeholder")}
            prefixIcon={<Mail className="w-[16px] h-[16px]" />}
            {...register("contactEmail")}
            error={errors.contactEmail?.message}
          />
          <Input
            label={t("createLead.phone.label")}
            type="tel"
            placeholder={t("createLead.phone.placeholder")}
            prefixIcon={<Phone className="w-[16px] h-[16px]" />}
            value={phoneValue || ""}
            onChange={handlePhoneChange}
          />
        </div>
      </div>

      {/* ── Deal — the facts, then the title they compose. */}
      <div className="space-y-2 pt-1 border-t border-line">
        <SectionHeader>{t("createLead.section.deal")}</SectionHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5">
            <label
              id="create-lead-source-label"
              className="font-mohave text-caption-sm text-text-3 uppercase tracking-[0.08em]"
            >
              {t("createLead.source.label")}
            </label>
            <Select
              options={sourceOptions}
              value={watch("source") || undefined}
              onChange={handleSourceChange}
              placeholder={t("createLead.source.placeholder")}
              contentClassName="z-modal"
              aria-describedby="create-lead-source-label"
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <label
              id="create-lead-priority-label"
              className="font-mohave text-caption-sm text-text-3 uppercase tracking-[0.08em]"
            >
              {t("createLead.priority.label")}
            </label>
            <Select
              options={priorityOptions}
              value={watch("priority") || undefined}
              onChange={(v) =>
                setValue("priority", (v === NONE ? "" : v) as LeadFormData["priority"], {
                  shouldDirty: true,
                })
              }
              placeholder={t("createLead.priority.placeholder")}
              contentClassName="z-modal"
              aria-describedby="create-lead-priority-label"
            />
          </div>
        </div>

        <Input
          label={t("createLead.value.label")}
          type="number"
          inputMode="decimal"
          placeholder={t("createLead.value.placeholder")}
          prefixIcon={<DollarSign className="w-[16px] h-[16px]" />}
          className="font-mono tabular-nums [font-feature-settings:'tnum'_1,'zero'_1]"
          {...register("estimatedValue", {
            setValueAs: (v) => (v === "" || v === undefined ? null : parseFloat(v)),
          })}
        />

        <div className="flex flex-col gap-0.5">
          <label
            htmlFor="create-lead-address"
            className="font-mohave text-caption-sm text-text-3 uppercase tracking-[0.08em]"
          >
            {t("createLead.address.label")}
          </label>
          <AddressAutocomplete
            id="create-lead-address"
            value={watch("address") ?? ""}
            placeholder={t("createLead.address.placeholder")}
            ariaLabel={t("createLead.address.label")}
            portalListbox
            onChange={handleAddressSelect}
            onDraftChange={handleAddressDraft}
          />
        </div>

        <Input
          label={`${t("createLead.title.label")} *`}
          placeholder={t("createLead.title.placeholder")}
          {...register("title", {
            onChange: (e) => setTitleManuallyEdited(e.target.value.trim().length > 0),
          })}
          error={errors.title?.message}
        />
      </div>

      {/* ── Notes */}
      <div className="space-y-2 pt-1 border-t border-line">
        <SectionHeader>{t("createLead.section.notes")}</SectionHeader>
        <Textarea
          aria-label={t("createLead.section.notes")}
          placeholder={t("createLead.notes.placeholder")}
          {...register("description")}
          rows={3}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1 pt-1">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isSaving}>
            {t("createLead.cancel")}
          </Button>
        )}
        <Button type="submit" loading={isSaving} className="gap-[6px]">
          <Save className="w-[16px] h-[16px]" />
          {t("createLead.submit")}
        </Button>
      </div>
    </form>
  );
}

// The old `CreateLeadModal` Dialog wrapper was removed 2026-07-02: the form's
// one real mount is the "create-lead" FloatingWindow in dashboard-layout, and
// the wrapper had no consumers.
