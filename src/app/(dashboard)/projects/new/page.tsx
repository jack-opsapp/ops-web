"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Save, Search, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { EntityPicker } from "@/components/ui/entity-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateProject } from "@/lib/hooks/use-projects";
import { useClients } from "@/lib/hooks/use-clients";
import { useClientCreateAction } from "@/lib/hooks/use-client-create-action";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { useAuthStore } from "@/lib/store/auth-store";
import {
  ProjectStatus,
  getUserFullName,
  getInitials,
  type Client,
  type User,
} from "@/lib/types/models";

// ─── Form Schema ───────────────────────────────────────────────────────────────

const projectFormSchema = z.object({
  title: z.string().min(1, "Project name is required").max(200, "Name too long"),
  clientId: z.string().nullable(),
  address: z.string().max(500).optional().or(z.literal("")),
  status: z.nativeEnum(ProjectStatus),
  startDate: z.string().optional().or(z.literal("")),
  endDate: z.string().optional().or(z.literal("")),
  projectDescription: z.string().max(2000).optional().or(z.literal("")),
  notes: z.string().max(5000).optional().or(z.literal("")),
  teamMemberIds: z.array(z.string()),
});

type ProjectFormData = z.infer<typeof projectFormSchema>;

// ─── Status Options ────────────────────────────────────────────────────────────

const statusOptions: { value: ProjectStatus; key: string }[] = [
  { value: ProjectStatus.RFQ, key: "status.rfq" },
  { value: ProjectStatus.Estimated, key: "status.estimated" },
  { value: ProjectStatus.Accepted, key: "status.accepted" },
  { value: ProjectStatus.InProgress, key: "status.inProgress" },
];

// ─── Client Selector ───────────────────────────────────────────────────────────

// On the canonical EntityPicker (previously a hand-rolled absolute dropdown —
// the Picker kit docstring mandates the shared shell). The trigger keeps the
// form's 36px field look; this page is a plain route, so the panel's default
// `z-dropdown` layer is correct.
function ClientSelector({
  value,
  onChange,
  clients,
  isLoadingClients,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  clients: Client[];
  isLoadingClients: boolean;
}) {
  const { t } = useDictionary("projects");
  const { t: tp } = useDictionary("picker");
  const selected = clients.find((c) => c.id === value) ?? null;
  const createAction = useClientCreateAction(useCallback((id: string) => onChange(id), [onChange]));

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
        {t("new.clientLabel")}
      </label>
      <EntityPicker<Client>
        trigger={
          <button
            type="button"
            disabled={isLoadingClients}
            className={cn(
              "flex w-full min-h-[36px] items-center justify-between gap-2 px-2",
              "font-mohave text-body text-left",
              "bg-surface-input rounded border border-glass-border",
              "transition-colors duration-150",
              "hover:border-glass-border-medium",
              "focus:outline-none focus:border-glass-border-strong",
              "disabled:cursor-not-allowed disabled:opacity-40",
              selected ? "text-text" : "text-text-3",
            )}
          >
            <span className="truncate">
              {isLoadingClients
                ? t("new.loadingClients")
                : selected
                  ? selected.name
                  : t("new.searchClients")}
            </span>
            <Search className="w-[16px] h-[16px] shrink-0 text-text-3" strokeWidth={1.5} />
          </button>
        }
        label={t("new.clientLabel")}
        items={clients}
        value={value}
        onChange={onChange}
        getId={(c) => c.id}
        getLabel={(c) => c.name}
        searchPlaceholder={t("new.searchClients")}
        clearLabel={tp("clear")}
        emptyLabel={clients.length === 0 ? t("new.noClients") : t("new.noMatchingClients")}
        noneOption
        noneLabel={t("new.noClient")}
        createAction={createAction}
      />
    </div>
  );
}

// ─── Team Member Selector ──────────────────────────────────────────────────────

function TeamMemberSelector({
  selectedIds,
  onChange,
  members,
  isLoading,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  members: User[];
  isLoading: boolean;
}) {
  const { t } = useDictionary("projects");
  function toggleMember(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((i) => i !== id)
        : [...selectedIds, id]
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-0.5">
        <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
          {t("new.teamLabel")}
        </label>
        <div className="flex flex-wrap gap-1">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[36px] w-[120px] bg-fill-neutral-dim rounded animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="flex flex-col gap-0.5">
        <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
          {t("new.teamLabel")}
        </label>
        <p className="font-mohave text-body-sm text-text-3">
          {t("new.noTeam")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
        {t("new.teamLabel")}
      </label>
      <div className="flex flex-wrap gap-1">
        {members.map((member) => {
          const isSelected = selectedIds.includes(member.id);
          const fullName = getUserFullName(member);
          return (
            <button
              key={member.id}
              type="button"
              onClick={() => toggleMember(member.id)}
              className={cn(
                "flex items-center gap-[6px] px-1.5 py-[8px] rounded border transition-all",
                isSelected
                  ? "bg-[rgba(255,255,255,0.08)] text-text border-[rgba(255,255,255,0.18)]"
                  : "bg-surface-input border-border text-text-3 hover:text-text-2"
              )}
            >
              <div
                className={cn(
                  "w-[20px] h-[20px] rounded-full flex items-center justify-center text-micro",
                  isSelected
                    ? "bg-text-2 text-background"
                    : "bg-fill-neutral-dim text-text-3"
                )}
              >
                {isSelected ? (
                  <Check className="w-[12px] h-[12px]" />
                ) : (
                  getInitials(fullName)
                )}
              </div>
              <span className="font-mohave text-body-sm">{fullName}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function NewProjectPage() {
  usePageTitle("New Project");
  const { t } = useDictionary("projects");
  const router = useRouter();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  // Data hooks
  const { data: clientsData, isLoading: isLoadingClients } = useClients();
  const { data: teamData, isLoading: isLoadingTeam } = useTeamMembers();
  const createProjectMutation = useCreateProject();

  const clients = useMemo(() => clientsData?.clients ?? [], [clientsData?.clients]);
  const teamMembers = teamData?.users ?? [];

  // A `?clientId=` deep link (client-list widget's "Create Project" action)
  // preselects the client. Cleared below if the id never resolves.
  const searchParams = useSearchParams();
  const preselectedClientId = searchParams.get("clientId");

  // Form
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<ProjectFormData>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      title: "",
      clientId: preselectedClientId,
      address: "",
      status: ProjectStatus.RFQ,
      startDate: "",
      endDate: "",
      projectDescription: "",
      notes: "",
      teamMemberIds: [],
    },
  });

  useEffect(() => {
    if (!preselectedClientId || isLoadingClients) return;
    if (!clients.some((c) => c.id === preselectedClientId)) {
      setValue("clientId", null);
    }
  }, [preselectedClientId, isLoadingClients, clients, setValue]);

  const [serverError, setServerError] = useState<string | null>(null);

  // Surface a top-level banner whenever zod validation fails so the user
  // never has to hunt for the inline error on a long form. Scroll the
  // first invalid field into view.
  function handleInvalid(formErrors: typeof errors) {
    setServerError(t("new.validationError"));
    const firstErrorKey = Object.keys(formErrors)[0];
    if (typeof window !== "undefined" && firstErrorKey) {
      requestAnimationFrame(() => {
        const el =
          document.querySelector<HTMLElement>(`[name="${firstErrorKey}"]`) ??
          document.querySelector<HTMLElement>(`#${firstErrorKey}`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (el && typeof (el as HTMLInputElement).focus === "function") {
          (el as HTMLInputElement).focus({ preventScroll: true });
        }
      });
    }
  }

  // Submit handler
  async function onSubmit(data: ProjectFormData) {
    if (!companyId) {
      setServerError(t("new.noCompany"));
      return;
    }

    setServerError(null);

    createProjectMutation.mutate(
      {
        title: data.title,
        companyId,
        clientId: data.clientId,
        address: data.address || null,
        status: data.status,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        projectDescription: data.projectDescription || null,
        notes: data.notes || null,
        teamMemberIds: data.teamMemberIds,
        projectImages: [],
        allDay: true,
        latitude: null,
        longitude: null,
        duration: null,
      },
      {
        onSuccess: (projectId) => {
          router.push(`/projects/${projectId}`);
        },
        onError: (err) => {
          setServerError(
            err instanceof Error
              ? err.message
              : t("new.createFailed")
          );
        },
      }
    );
  }

  const isSaving = createProjectMutation.isPending;

  return (
    <div className="max-w-[720px] space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/projects")}
        >
          <ArrowLeft className="w-[20px] h-[20px]" />
        </Button>
        <h1 className="font-mohave text-display text-text tracking-wide">
          {t("new.heading")}
        </h1>
      </div>

      {/* Server Error */}
      {serverError && (
        <div className="bg-ops-error-muted border border-ops-error/30 rounded px-1.5 py-1 animate-slide-up">
          <p className="font-mohave text-body-sm text-ops-error">{serverError}</p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit, handleInvalid)} noValidate>
        <div className="bg-glass glass-surface border border-border rounded-lg p-3 space-y-3">
          {/* Project Name */}
          <Input
            label={t("new.nameLabel")}
            placeholder={t("new.namePlaceholder")}
            helperText={t("new.requiredHint")}
            aria-required="true"
            required
            {...register("title")}
            error={errors.title?.message}
          />

          {/* Client Selector */}
          <Controller
            name="clientId"
            control={control}
            render={({ field }) => (
              <ClientSelector
                value={field.value}
                onChange={field.onChange}
                clients={clients}
                isLoadingClients={isLoadingClients}
              />
            )}
          />

          {/* Address */}
          <Input
            label={t("new.addressLabel")}
            placeholder={t("new.addressPlaceholder")}
            {...register("address")}
            error={errors.address?.message}
          />

          {/* Status */}
          <Controller
            name="status"
            control={control}
            render={({ field }) => (
              <div className="flex flex-col gap-0.5">
                <label className="font-mono text-caption-sm text-text-2 uppercase tracking-widest">
                  {t("new.statusLabel")}
                </label>
                <div className="flex items-center gap-1">
                  {statusOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => field.onChange(opt.value)}
                      className={cn(
                        "px-1.5 py-[8px] rounded border font-mohave text-body-sm transition-all",
                        field.value === opt.value
                          ? "bg-[rgba(255,255,255,0.08)] text-text border-[rgba(255,255,255,0.18)]"
                          : "bg-surface-input border-border text-text-3 hover:text-text-2"
                      )}
                    >
                      {t(opt.key)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          />

          {/* Date Range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              label={t("new.startDateLabel")}
              type="date"
              {...register("startDate")}
              error={errors.startDate?.message}
            />
            <Input
              label={t("new.endDateLabel")}
              type="date"
              {...register("endDate")}
              error={errors.endDate?.message}
            />
          </div>

          {/* Team Members */}
          <Controller
            name="teamMemberIds"
            control={control}
            render={({ field }) => (
              <TeamMemberSelector
                selectedIds={field.value}
                onChange={field.onChange}
                members={teamMembers}
                isLoading={isLoadingTeam}
              />
            )}
          />

          {/* Description */}
          <Textarea
            label={t("new.descriptionLabel")}
            placeholder={t("new.descriptionPlaceholder")}
            {...register("projectDescription")}
            error={errors.projectDescription?.message}
          />

          {/* Notes */}
          <Textarea
            label={t("new.notesLabel")}
            placeholder={t("new.notesPlaceholder")}
            {...register("notes")}
            error={errors.notes?.message}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-1 mt-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/projects")}
            disabled={isSaving}
          >
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            loading={isSaving}
            className="gap-[6px]"
          >
            <Save className="w-[16px] h-[16px]" />
            {t("new.createProject")}
          </Button>
        </div>
      </form>
    </div>
  );
}
