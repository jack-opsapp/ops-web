"use client";

import { Search } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { useProjectCanvasStore, type ProjectSortOption } from "./project-canvas-store";

interface ProjectFloatingToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  teamMembers: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  selectedMemberId: string | null;
  onMemberFilterChange: (memberId: string | null) => void;
  selectedClientId: string | null;
  onClientFilterChange: (clientId: string | null) => void;
  canViewAccounting: boolean;
}

export function ProjectFloatingToolbar({
  searchQuery,
  onSearchChange,
  teamMembers,
  clients,
  selectedMemberId,
  onMemberFilterChange,
  selectedClientId,
  onClientFilterChange,
  canViewAccounting,
}: ProjectFloatingToolbarProps) {
  const { t } = useDictionary("projects-canvas");
  const sortBy = useProjectCanvasStore((s) => s.sortBy);
  const setSortBy = useProjectCanvasStore((s) => s.setSortBy);

  const sortOptions: { value: ProjectSortOption; label: string }[] = [
    { value: "title", label: t("sort.title") },
    { value: "client", label: t("sort.client") },
    { value: "date", label: t("sort.date") },
    ...(canViewAccounting ? [{ value: "value" as const, label: t("sort.value") }] : []),
    { value: "progress", label: t("sort.progress") },
  ];

  return (
    <div
      className="flex items-center gap-2 px-4 py-2"
      style={{
        background: "rgba(10,10,10,0.7)",
        backdropFilter: "blur(20px) saturate(1.2)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Search */}
      <div className="relative flex-1 max-w-[260px]">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-disabled" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("toolbar.search")}
          className="w-full pl-7 pr-3 py-1.5 rounded-[3px] font-mohave text-body-sm text-text-primary bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] placeholder:text-text-disabled focus:outline-none focus:border-[rgba(89,119,148,0.3)]"
        />
      </div>

      {/* Team member filter */}
      <select
        value={selectedMemberId ?? ""}
        onChange={(e) => onMemberFilterChange(e.target.value || null)}
        className="px-2 py-1.5 rounded-[3px] font-mohave text-body-sm text-text-secondary bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] focus:outline-none"
      >
        <option value="">{t("toolbar.allMembers")}</option>
        {teamMembers.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>

      {/* Client filter */}
      <select
        value={selectedClientId ?? ""}
        onChange={(e) => onClientFilterChange(e.target.value || null)}
        className="px-2 py-1.5 rounded-[3px] font-mohave text-body-sm text-text-secondary bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] focus:outline-none"
      >
        <option value="">{t("toolbar.allClients")}</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      {/* Sort */}
      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value as ProjectSortOption)}
        className="px-2 py-1.5 rounded-[3px] font-mohave text-body-sm text-text-secondary bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] focus:outline-none"
      >
        {sortOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
