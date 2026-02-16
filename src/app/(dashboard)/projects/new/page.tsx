"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Save, X, Search, Plus, Check, Palette } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateProject } from "@/lib/hooks/use-projects";
import { useClients } from "@/lib/hooks/use-clients";
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

const statusOptions: { value: ProjectStatus; label: string }[] = [
  { value: ProjectStatus.RFQ, label: "RFQ" },
  { value: ProjectStatus.Estimated, label: "Estimated" },
  { value: ProjectStatus.Accepted, label: "Accepted" },
  { value: ProjectStatus.InProgress, label: "In Progress" },
];

// ─── Default Project Colors ────────────────────────────────────────────────────

const PROJECT_COLORS = [
  "#417394", // Steel blue
  "#C4A868", // Amber
  "#9DB582", // Green
  "#B58289", // Rose
  "#A182B5", // Purple
  "#B5A381", // Warm gold
  "#8195B5", // Light blue
  "#82B5A1", // Teal
  "#B5828D", // Pink
  "#BCBCBC", // Gray
];

// ─── Client Selector ───────────────────────────────────────────────────────────

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
  const [clientSearch, setClientSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const filteredClients = useMemo(
    () =>
      clients.filter((c) =>
        c.name.toLowerCase().includes(clientSearch.toLowerCase())
      ),
    [clients, clientSearch]
  );

  const selectedClient = clients.find((c) => c.id === value);

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
        Client
      </label>
      <div className="relative">
        {selectedClient ? (
          <div className="flex items-center justify-between bg-background-input border border-border rounded-lg px-1.5 py-1.5">
            <span className="font-mohave text-body text-text-primary">
              {selectedClient.name}
            </span>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setClientSearch("");
              }}
              className="text-text-tertiary hover:text-text-secondary"
            >
              <X className="w-[16px] h-[16px]" />
            </button>
          </div>
        ) : (
          <div>
            <Input
              placeholder={isLoadingClients ? "Loading clients..." : "Search clients..."}
              value={clientSearch}
              onChange={(e) => {
                setClientSearch(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              prefixIcon={<Search className="w-[16px] h-[16px]" />}
              disabled={isLoadingClients}
            />
            {showDropdown && !isLoadingClients && (
              <div className="absolute z-10 left-0 right-0 top-full mt-[4px] bg-background-panel border border-border rounded-lg shadow-floating max-h-[200px] overflow-y-auto">
                {filteredClients.length === 0 ? (
                  <div className="px-1.5 py-1 text-center">
                    <p className="font-mohave text-body-sm text-text-tertiary">
                      {clients.length === 0 ? "No clients found" : "No matching clients"}
                    </p>
                  </div>
                ) : (
                  filteredClients.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onMouseDown={() => {
                        onChange(client.id);
                        setShowDropdown(false);
                        setClientSearch("");
                      }}
                      className="w-full px-1.5 py-1 text-left font-mohave text-body text-text-secondary hover:text-text-primary hover:bg-background-elevated transition-colors"
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
        <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
          Team Members
        </label>
        <div className="flex flex-wrap gap-1">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[36px] w-[120px] bg-background-elevated rounded animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="flex flex-col gap-0.5">
        <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
          Team Members
        </label>
        <p className="font-mohave text-body-sm text-text-tertiary">
          No team members available
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
        Team Members
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
                  ? "bg-ops-accent-muted border-ops-accent text-ops-accent"
                  : "bg-background-input border-border text-text-tertiary hover:text-text-secondary"
              )}
            >
              <div
                className={cn(
                  "w-[20px] h-[20px] rounded-full flex items-center justify-center text-[10px]",
                  isSelected
                    ? "bg-ops-accent text-white"
                    : "bg-background-elevated text-text-tertiary"
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
  const router = useRouter();
  const { company } = useAuthStore();
  const companyId = company?.id ?? "";

  // Data hooks
  const { data: clientsData, isLoading: isLoadingClients } = useClients();
  const { data: teamData, isLoading: isLoadingTeam } = useTeamMembers();
  const createProjectMutation = useCreateProject();

  const clients = clientsData?.clients ?? [];
  const teamMembers = teamData?.users ?? [];

  // Form
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ProjectFormData>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      title: "",
      clientId: null,
      address: "",
      status: ProjectStatus.RFQ,
      startDate: "",
      endDate: "",
      projectDescription: "",
      notes: "",
      teamMemberIds: [],
    },
  });

  const [serverError, setServerError] = useState<string | null>(null);

  // Submit handler
  async function onSubmit(data: ProjectFormData) {
    if (!companyId) {
      setServerError("No company found. Please sign in again.");
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
              : "Failed to create project. Please try again."
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
        <h1 className="font-mohave text-display text-text-primary tracking-wide">
          NEW PROJECT
        </h1>
      </div>

      {/* Server Error */}
      {serverError && (
        <div className="bg-ops-error-muted border border-ops-error/30 rounded px-1.5 py-1 animate-slide-up">
          <p className="font-mohave text-body-sm text-ops-error">{serverError}</p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="bg-background-panel border border-border rounded-lg p-3 space-y-3">
          {/* Project Name */}
          <Input
            label="Project Name"
            placeholder="e.g., Kitchen Renovation - Smith"
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
            label="Address"
            placeholder="123 Main Street, City, State ZIP"
            {...register("address")}
            error={errors.address?.message}
          />

          {/* Status */}
          <Controller
            name="status"
            control={control}
            render={({ field }) => (
              <div className="flex flex-col gap-0.5">
                <label className="font-kosugi text-caption-sm text-text-secondary uppercase tracking-widest">
                  Status
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
                          ? "bg-ops-accent-muted border-ops-accent text-ops-accent"
                          : "bg-background-input border-border text-text-tertiary hover:text-text-secondary"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          />

          {/* Date Range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              label="Start Date"
              type="date"
              {...register("startDate")}
              error={errors.startDate?.message}
            />
            <Input
              label="End Date"
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
            label="Description"
            placeholder="Project description..."
            {...register("projectDescription")}
            error={errors.projectDescription?.message}
          />

          {/* Notes */}
          <Textarea
            label="Notes"
            placeholder="Project notes, special instructions..."
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
            Cancel
          </Button>
          <Button
            type="submit"
            loading={isSaving}
            className="gap-[6px]"
          >
            <Save className="w-[16px] h-[16px]" />
            Create Project
          </Button>
        </div>
      </form>
    </div>
  );
}
