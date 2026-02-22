"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  Phone,
  Mail,
  MapPin,
  FolderKanban,
  Users,
  ChevronDown,
  ChevronRight,
  Building2,
} from "lucide-react";
import { trackScreenView } from "@/lib/analytics/analytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useClients } from "@/lib/hooks";
import { useProjects } from "@/lib/hooks/use-projects";
import { getInitials } from "@/lib/types/models";
import type { Client, SubClient } from "@/lib/types/models";
import { usePageActionsStore } from "@/stores/page-actions-store";
import { useWindowStore } from "@/stores/window-store";
import { SegmentedPicker } from "@/components/ops/segmented-picker";

type ViewMode = "cards" | "table";
type FilterMode = "all" | "with-projects" | "no-projects";

interface ClientListItem {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  projectCount: string;
  subClients: { id: string; name: string; title: string | null; phone: string | null; email: string | null }[];
  lastActivity: string;
}

function mapClientToListItem(client: Client, projectCount: number): ClientListItem {
  const subClients: ClientListItem["subClients"] = (client.subClients ?? [])
    .filter((sc) => !sc.deletedAt)
    .map((sc: SubClient) => ({
      id: sc.id,
      name: sc.name,
      title: sc.title ?? null,
      phone: sc.phoneNumber ?? null,
      email: sc.email ?? null,
    }));

  return {
    id: client.id,
    name: client.name,
    company: null,
    email: client.email ?? null,
    phone: client.phoneNumber ?? null,
    address: client.address ?? null,
    projectCount: String(projectCount),
    subClients,
    lastActivity: client.createdAt
      ? new Date(client.createdAt).toISOString().slice(0, 10)
      : "",
  };
}

const filterOptions: { value: FilterMode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "with-projects", label: "Active" },
  { value: "no-projects", label: "New" },
];

// ─── Client Card (Grid View) ────────────────────────────────────────────────

function ClientCard({ client, onClick }: { client: ClientListItem; onClick: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card variant="interactive" className="p-0 overflow-hidden" onClick={onClick}>
      <div className="p-2 space-y-1.5">
        {/* Header: Avatar + Name + Company */}
        <div className="flex items-center gap-1.5">
          <div className="w-[44px] h-[44px] rounded-full bg-ops-accent-muted flex items-center justify-center shrink-0">
            <span className="font-mohave text-body-lg text-ops-accent">
              {getInitials(client.name) || "?"}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-mohave text-card-title text-text-primary truncate">
              {client.name}
            </h3>
            {client.company && (
              <div className="flex items-center gap-[4px]">
                <Building2 className="w-[11px] h-[11px] text-text-disabled shrink-0" />
                <p className="font-kosugi text-[10px] text-text-tertiary truncate">
                  {client.company}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Contact info */}
        <div className="space-y-[6px]">
          {client.phone && (
            <div className="flex items-center gap-[6px] text-text-tertiary">
              <Phone className="w-[13px] h-[13px] shrink-0" />
              <span className="font-mono text-data-sm">{client.phone}</span>
            </div>
          )}
          {client.email && (
            <div className="flex items-center gap-[6px] text-text-tertiary">
              <Mail className="w-[13px] h-[13px] shrink-0" />
              <span className="font-mono text-[11px] truncate">{client.email}</span>
            </div>
          )}
          {client.address && (
            <div className="flex items-center gap-[6px] text-text-tertiary">
              <MapPin className="w-[13px] h-[13px] shrink-0" />
              <span className="font-mohave text-body-sm truncate">{client.address}</span>
            </div>
          )}
        </div>

        {/* Footer: Projects + SubClients */}
        <div className="flex items-center justify-between pt-[6px] border-t border-border-subtle">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-[4px] text-text-tertiary">
              <FolderKanban className="w-[13px] h-[13px]" />
              <span className="font-mono text-[11px]">
                {client.projectCount} {client.projectCount === "1" ? "project" : "projects"}
              </span>
            </div>
          </div>
          {client.subClients.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
              className="flex items-center gap-[3px] text-text-tertiary hover:text-ops-accent transition-colors"
            >
              <Users className="w-[12px] h-[12px]" />
              <span className="font-mono text-[10px]">{client.subClients.length}</span>
              {expanded ? (
                <ChevronDown className="w-[12px] h-[12px]" />
              ) : (
                <ChevronRight className="w-[12px] h-[12px]" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Expanded SubClients */}
      {expanded && client.subClients.length > 0 && (
        <div
          className="border-t border-border-subtle bg-background-elevated/50 px-2 py-1.5 space-y-1 animate-slide-up"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest">
            Sub-Clients
          </span>
          {client.subClients.map((sc) => (
            <div key={sc.id} className="flex items-center justify-between py-[4px]">
              <div className="min-w-0">
                <p className="font-mohave text-body-sm text-text-secondary truncate">
                  {sc.name}
                  {sc.title && (
                    <span className="text-text-disabled ml-[6px] font-kosugi text-[10px]">
                      {sc.title}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {sc.phone && (
                  <span className="font-mono text-[10px] text-text-disabled">{sc.phone}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Client Table Row ────────────────────────────────────────────────────────

function ClientTableRow({
  client,
  onClick,
}: {
  client: ClientListItem;
  onClick: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className="border-b border-border-subtle hover:bg-background-elevated cursor-pointer transition-colors group"
    >
      {/* Name + Company */}
      <td className="px-1.5 py-1">
        <div className="flex items-center gap-1">
          <div className="w-[32px] h-[32px] rounded-full bg-ops-accent-muted flex items-center justify-center shrink-0">
            <span className="font-mohave text-body-sm text-ops-accent">
              {getInitials(client.name) || "?"}
            </span>
          </div>
          <div className="min-w-0">
            <span className="font-mohave text-body text-text-primary block truncate">
              {client.name}
            </span>
            {client.company && (
              <span className="font-kosugi text-[10px] text-text-disabled block truncate">
                {client.company}
              </span>
            )}
          </div>
        </div>
      </td>
      {/* Email */}
      <td className="px-1.5 py-1 hidden md:table-cell">
        <span className="font-mono text-data-sm text-text-tertiary truncate block max-w-[200px]">
          {client.email || "--"}
        </span>
      </td>
      {/* Phone */}
      <td className="px-1.5 py-1 hidden sm:table-cell">
        <span className="font-mono text-data-sm text-text-tertiary">
          {client.phone || "--"}
        </span>
      </td>
      {/* Address */}
      <td className="px-1.5 py-1 hidden lg:table-cell">
        <span className="font-mohave text-body-sm text-text-tertiary truncate block max-w-[180px]">
          {client.address || "--"}
        </span>
      </td>
      {/* Projects */}
      <td className="px-1.5 py-1 text-center">
        <span className="font-mono text-data-sm text-text-secondary">
          {client.projectCount}
        </span>
      </td>
      {/* Sub-Clients */}
      <td className="px-1.5 py-1 text-center hidden sm:table-cell">
        {client.subClients.length > 0 ? (
          <Badge variant="info" className="text-[10px] px-[6px] py-[1px]">
            {client.subClients.length}
          </Badge>
        ) : (
          <span className="font-mono text-[11px] text-text-disabled">--</span>
        )}
      </td>
    </tr>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function LoadingSkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === "cards") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-background-card border border-border rounded-lg p-2 space-y-1.5 animate-pulse"
          >
            <div className="flex items-center gap-1.5">
              <div className="w-[44px] h-[44px] rounded-full bg-background-elevated" />
              <div className="flex-1 space-y-1">
                <div className="h-[16px] bg-background-elevated rounded w-3/4" />
                <div className="h-[12px] bg-background-elevated rounded w-1/2" />
              </div>
            </div>
            <div className="h-[14px] bg-background-elevated rounded w-full" />
            <div className="h-[14px] bg-background-elevated rounded w-2/3" />
            <div className="flex justify-between pt-1 border-t border-border-subtle">
              <div className="h-[14px] bg-background-elevated rounded w-[80px]" />
              <div className="h-[14px] bg-background-elevated rounded w-[40px]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-[2px] animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-[52px] bg-background-card border border-border rounded"
        />
      ))}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const openWindow = useWindowStore((s) => s.openWindow);
  const openCreateClient = () => openWindow({ id: "create-client", title: "New Client", type: "create-client" });

  // Track screen view
  useEffect(() => { trackScreenView("clients"); }, []);

  // Set page actions in top bar
  const setActions = usePageActionsStore((s) => s.setActions);
  const clearActions = usePageActionsStore((s) => s.clearActions);
  useEffect(() => {
    setActions([
      { label: "New Client", icon: Plus, onClick: openCreateClient, shortcut: "\u2318\u21E7C" },
    ]);
    return () => clearActions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setActions, clearActions]);

  const { data, isLoading } = useClients();
  const { data: projectsData } = useProjects();

  // Build project count per client from projects data
  const projectCountByClient = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projectsData?.projects ?? []) {
      if (project.clientId) {
        counts.set(project.clientId, (counts.get(project.clientId) ?? 0) + 1);
      }
    }
    return counts;
  }, [projectsData]);

  const clients: ClientListItem[] = useMemo(() => {
    const rawClients = data?.clients ?? [];
    return rawClients
      .filter((c) => !c.deletedAt)
      .map((c) => mapClientToListItem(c, projectCountByClient.get(c.id) ?? 0));
  }, [data, projectCountByClient]);

  const totalCount = data?.count ?? clients.length;
  const totalSubClients = clients.reduce((sum, c) => sum + c.subClients.length, 0);

  const filteredClients = useMemo(() => {
    let filtered = [...clients];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.company?.toLowerCase().includes(query) ||
          c.email?.toLowerCase().includes(query) ||
          c.phone?.includes(query) ||
          c.address?.toLowerCase().includes(query) ||
          c.subClients.some((sc) => sc.name.toLowerCase().includes(query))
      );
    }

    // Status filter - since we don't have projectCount from the API,
    // we disable these filters when data is from API (projectCount is "--")
    if (filterMode === "with-projects") {
      filtered = filtered.filter((c) => c.projectCount !== "0" && c.projectCount !== "--");
    } else if (filterMode === "no-projects") {
      filtered = filtered.filter((c) => c.projectCount === "0" || c.projectCount === "--");
    }

    return filtered;
  }, [clients, searchQuery, filterMode]);

  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-kosugi text-caption-sm text-text-tertiary">
            {totalCount} clients
          </span>
          <span className="text-text-disabled font-mono text-[10px]">|</span>
          <span className="font-kosugi text-caption-sm text-text-tertiary">
            {totalSubClients} sub-contacts
          </span>
        </div>
        <Button className="gap-[6px]" onClick={() => openCreateClient()}>
          <Plus className="w-[16px] h-[16px]" />
          New Client
        </Button>
      </div>

      {/* Search + Filters + View Toggle */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 max-w-[400px]">
          <Input
            placeholder="Search clients, companies, contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            prefixIcon={<Search className="w-[16px] h-[16px]" />}
          />
        </div>

        <div className="flex items-center gap-1">
          {/* Filter tabs */}
          <SegmentedPicker
            options={filterOptions.map((o) => ({ value: o.value, label: o.label }))}
            value={filterMode}
            onChange={setFilterMode}
          />

          {/* View toggle */}
          <SegmentedPicker
            options={[
              { value: "cards" as ViewMode, label: "Cards", icon: LayoutGrid },
              { value: "table" as ViewMode, label: "Table", icon: List },
            ]}
            value={viewMode}
            onChange={setViewMode}
            iconOnly
          />
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <LoadingSkeleton viewMode={viewMode} />
      ) : filteredClients.length === 0 && !searchQuery && filterMode === "all" ? (
        /* Empty state - no clients at all */
        <div className="flex flex-col items-center justify-center py-8">
          <div className="w-[64px] h-[64px] rounded-lg bg-ops-accent-muted flex items-center justify-center mb-2">
            <Users className="w-[32px] h-[32px] text-ops-accent" />
          </div>
          <h3 className="font-mohave text-heading text-text-primary">
            No clients yet
          </h3>
          <p className="font-kosugi text-caption text-text-tertiary mt-0.5 max-w-[320px]">
            Add your first client to start managing relationships, contacts, and projects.
          </p>
          <Button
            className="mt-3 gap-[6px]"
            onClick={() => openCreateClient()}
          >
            <Plus className="w-[16px] h-[16px]" />
            Add First Client
          </Button>
        </div>
      ) : filteredClients.length === 0 ? (
        /* Empty state - filtered/searched with no results */
        <div className="flex flex-col items-center justify-center py-6">
          <Search className="w-[40px] h-[40px] text-text-disabled mb-2" />
          <h3 className="font-mohave text-heading text-text-primary">
            No matching clients
          </h3>
          <p className="font-kosugi text-caption text-text-tertiary mt-0.5">
            Try adjusting your search or filter criteria
          </p>
        </div>
      ) : viewMode === "cards" ? (
        /* Card Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {filteredClients.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              onClick={() => router.push(`/clients/${client.id}`)}
            />
          ))}
        </div>
      ) : (
        /* Table View */
        <div className="bg-background-card border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Client
                </th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden md:table-cell">
                  Email
                </th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">
                  Phone
                </th>
                <th className="px-1.5 py-1 text-left font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden lg:table-cell">
                  Address
                </th>
                <th className="px-1.5 py-1 text-center font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
                  Projects
                </th>
                <th className="px-1.5 py-1 text-center font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest hidden sm:table-cell">
                  Contacts
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => (
                <ClientTableRow
                  key={client.id}
                  client={client}
                  onClick={() => router.push(`/clients/${client.id}`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
